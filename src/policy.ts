import { createHash } from "node:crypto"
import { Schema } from "effect"

export class Stop extends Error {}
export class Pause extends Error {}
export type Phase = "completeness" | "review"
export const CONTRACT_VERSION = 13
export const ISSUE_CONTRACT_VERSION = 14
export const contractVersion = (pullRequest: boolean) => pullRequest ? CONTRACT_VERSION : ISSUE_CONTRACT_VERSION
export const MODELS = { completeness: "openai/gpt-6.1-terra#medium", review: "openai/gpt-6.1-sol#xhigh" }
export const LABELS = new Set(["needs-information", "needs-maintainer-decision", "review-ready", "review-blocked"])
export const ISSUE_LABELS = { bug: "bug", feature: "enhancement", disputed: "question", support: "question" } as const

// Compatible with the existing Python checkpoints, including ensure_ascii.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${canonical(k)}:${canonical(v)}`).join(",")}}`
  const text = JSON.stringify(value)
  if (text === undefined) throw new Pause("Unserializable checkpoint value")
  return text.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
}
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex")

export const ConfigSchema = Schema.Struct({
  repository: Schema.String, authors: Schema.Array(Schema.String), maintainers: Schema.Array(Schema.String),
  all_pr_authors_since: Schema.optional(Schema.String),
  all_issue_authors: Schema.optional(Schema.Boolean),
  tracked_prs: Schema.optional(Schema.Array(Schema.Int)),
  publisher_login: Schema.String, token_file: Schema.String, state_dir: Schema.String,
  decision_token_file: Schema.optional(Schema.String),
  transport: Schema.Array(Schema.String), pipelines: Schema.Array(Schema.Struct({ path: Schema.String, jobs: Schema.Array(Schema.String) })),
})
export type Config = typeof ConfigSchema.Type
function utcTimestamp(value: unknown) {
  if (typeof value !== "string") return NaN
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z") ? time : NaN
}
export function readConfig(value: unknown) {
  const config = Schema.decodeUnknownSync(ConfigSchema)(value, { onExcessProperty: "error" })
  if (config.all_pr_authors_since !== undefined && !Number.isFinite(utcTimestamp(config.all_pr_authors_since))) throw new Pause("all_pr_authors_since must be a UTC ISO timestamp")
  if (config.tracked_prs?.some(number => !Number.isSafeInteger(number) || number <= 0)) throw new Pause("tracked_prs must contain positive PR numbers")
  return config
}

const text = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const FindingSchema = Schema.Struct({
  id: text(2, 16), status: Schema.Literals(["open", "resolved", "withdrawn"]),
  concern: text(10, 600), resolution: text(10, 800), evidence: text(10, 1200),
})
export type FindingUpdate = typeof FindingSchema.Type
const AssessmentSchema = Schema.Struct({
  kind: Schema.Literals(["bug", "feature", "disputed", "support"]),
  scope: Schema.Literals(["routine", "fundamental", "uncertain"]),
  state: Schema.Literals(["continue", "needs-information", "needs-maintainer-decision", "blocked", "ready", "handoff", "support", "verified-fixed", "declined", "deferred"]),
  summary: text(20, 400), findings: Schema.Array(text(1, 800)).check(Schema.isMinLength(1)),
  next_step: Schema.Struct({ owner: Schema.Literals(["author", "maintainer", "none"]), action: text(10, 600) }),
  security: Schema.Literals(["PASS", "BLOCK", "NOT VERIFIED"]), blockers: Schema.Array(Schema.String),
  scope_decisions: Schema.Array(Schema.Int), malicious: Schema.Boolean,
  review_depth: Schema.optional(Schema.Literals(["intake", "thorough"])),
  finding_updates: Schema.optional(Schema.Array(FindingSchema).check(Schema.isMaxLength(40))),
  ci_assessment: Schema.optional(Schema.Array(Schema.Struct({ key: text(1, 400), relevance: Schema.Literals(["relevant", "unrelated", "uncertain"]), evidence: text(20, 1200) }))),
  issue_decision: Schema.optional(Schema.Struct({
    disposition: Schema.Literals(["accepted", "rejected", "deferred"]),
    comments: Schema.Array(Schema.Struct({ id: Schema.Int, quote: text(10, 1500) })).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
  })),
  author_prompt: Schema.optional(text(20, 2400)),
})
export type Assessment = typeof AssessmentSchema.Type
export function assessment(value: unknown, phase: Phase): Assessment {
  let result: Assessment
  try { result = Schema.decodeUnknownSync(AssessmentSchema)(value, { onExcessProperty: "error" }) }
  catch { throw new Pause("Invalid model output fields or values") }
  const { state, next_step, malicious, blockers, security } = result
  if (["needs-information", "needs-maintainer-decision", "blocked", "ready"].includes(state) && next_step.owner === "none") throw new Pause("Actionable states must name who acts next")
  if (["needs-maintainer-decision", "ready"].includes(state) && next_step.owner !== "maintainer") throw new Pause("Maintainer state requires a maintainer next step")
  if (malicious && state !== "blocked") throw new Pause("Detected attack must stop the item")
  if (state === "ready" && (phase !== "review" || result.review_depth !== "thorough" || security !== "PASS" || blockers.length)) throw new Pause("Readiness requires a thorough unblocked security pass")
  if (state === "continue") throw new Pause("Separate PR completeness continuation is retired")
  if (phase === "review") {
    if (!["needs-information", "needs-maintainer-decision", "blocked", "ready"].includes(state)) throw new Pause("Invalid PR review disposition")
    if (!result.review_depth || !result.finding_updates || !result.ci_assessment) throw new Pause("PR review needs depth, finding updates and CI assessment")
    if (result.review_depth === "intake" && !["needs-information", "needs-maintainer-decision", "blocked"].includes(state)) throw new Pause("Early stop needs a substantive blocker")
    if (result.review_depth === "intake" && security === "PASS") throw new Pause("Early intake cannot claim a completed security review")
    if (result.finding_updates.some(f => !/^F[1-9]\d*$/.test(f.id)) || new Set(result.finding_updates.map(f => f.id)).size !== result.finding_updates.length) throw new Pause("Invalid or duplicate finding IDs")
    if (state === "ready" && result.finding_updates.some(f => f.status === "open")) throw new Pause("Ready review has open findings")
    if (["needs-information", "blocked"].includes(state) && !blockers.length) throw new Pause("Blocked or incomplete review needs explicit blockers")
  } else if (result.review_depth || result.finding_updates || result.ci_assessment) throw new Pause("PR review fields on issue triage")
  if (result.author_prompt?.includes("```")) throw new Pause("Author prompt must not contain Markdown fences")
  return result
}

// GitHub documents are retained intact as evidence. Accessors below fail closed
// on absent gate fields; model output uses the strict schema above.
export type Document = Record<string, any>
export function authorAllowed(item: Document, config: Config, pullRequest: boolean) {
  const login = item.user?.login
  if (typeof login !== "string" || !login) return false
  return config.authors.includes(login.toLowerCase()) || (!pullRequest && config.all_issue_authors === true) || Boolean(pullRequest && (config.tracked_prs?.includes(item.number) ||
    config.all_pr_authors_since && utcTimestamp(item.created_at) >= utcTimestamp(config.all_pr_authors_since)))
}
export function eligible(item: Document, config: Config) {
  if (item.repository_url !== `https://api.github.com/repos/${config.repository}`) throw new Stop("repository mismatch")
  if (!authorAllowed(item, config, !!item.pull_request)) throw new Stop("item not enrolled for this author")
  if (item.state !== "open" || item.locked) throw new Stop("item closed or locked")
}
