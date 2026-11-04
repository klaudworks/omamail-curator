import { createHash } from "node:crypto"
import { Schema } from "effect"

export class Stop extends Error {}
export class Pause extends Error {}
export class CIWait extends Stop {
  constructor(reason: string, readonly progress = "Completeness passed; waiting for successful CI.") { super(reason) }
}
export type Phase = "completeness" | "final"
export const CONTRACT_VERSION = 12
export const ISSUE_CONTRACT_VERSION = 14
export const contractVersion = (pullRequest: boolean) => pullRequest ? CONTRACT_VERSION : ISSUE_CONTRACT_VERSION
export const MODELS = { completeness: "openai/gpt-6.1-terra#medium", final: "openai/gpt-6.1-sol#xhigh" }
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
const AssessmentSchema = Schema.Struct({
  kind: Schema.Literals(["bug", "feature", "disputed", "support"]),
  scope: Schema.Literals(["routine", "fundamental", "uncertain"]),
  state: Schema.Literals(["continue", "needs-information", "needs-maintainer-decision", "blocked", "ready", "handoff", "support", "verified-fixed", "declined", "deferred"]),
  summary: text(20, 400), findings: Schema.Array(text(1, 400)).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  next_step: Schema.Struct({ owner: Schema.Literals(["author", "maintainer", "none"]), action: text(10, 600) }),
  security: Schema.Literals(["PASS", "BLOCK", "NOT VERIFIED"]), blockers: Schema.Array(Schema.String),
  scope_decisions: Schema.Array(Schema.Int), malicious: Schema.Boolean,
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
  if (state === "ready" && (phase !== "final" || security !== "PASS" || blockers.length)) throw new Pause("Readiness requires a final unblocked security pass")
  if (state === "continue" && (phase !== "completeness" || blockers.length || malicious)) throw new Pause("Invalid stage continuation")
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

export function successfulRun(pr: Document, workflow: Document, workflowPath: string) {
  const candidates = workflow.runs.filter((run: Document) => run.workflow_id === workflow.id && run.event === "pull_request" && run.head_sha === pr.head.sha &&
    (run.pull_requests?.length ? run.pull_requests.some((p: Document) => p.number === pr.number) : run.head_repository?.id === pr.head.repo.id && run.head_branch === pr.head.ref))
  const run = candidates.sort((a: Document, b: Document) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0]
  if (!run) throw new CIWait(`CI missing: ${workflowPath}`, "Completeness passed; waiting for CI to start.")
  if (run.status !== "completed" || run.conclusion !== "success") throw new CIWait(`CI not successful: ${workflowPath} (${run.status}/${run.conclusion})`,
    run.conclusion === "action_required" ? "Completeness passed; a maintainer must approve the CI workflows." :
      run.status === "completed" ? "Completeness passed; CI needs attention before final review." : "Completeness passed; waiting for CI to finish.")
  return run as Document
}

export function successfulRuns(pr: Document, workflows: Record<string, Document>, config: Config) {
  return config.pipelines.map(spec => {
    const source = workflows[spec.path], run = successfulRun(pr, source, spec.path)
    const latest = new Map<string, Document>()
    for (const job of source.jobs[String(run.id)] ?? []) if (!latest.has(job.name) || job.id > latest.get(job.name)!.id) latest.set(job.name, job)
    if (!latest.size || [...latest.values()].some(j => j.status !== "completed" || j.conclusion !== "success")) throw new CIWait(`CI job missing or unsuccessful: ${spec.path}`)
    for (const pattern of spec.jobs) if (![...latest.keys()].some(name => new RegExp(`^(?:${pattern})$`).test(name))) throw new CIWait(`CI expected job missing: ${pattern}`)
    return { path: spec.path, id: run.id, attempt: run.run_attempt, sha: run.head_sha, url: run.html_url, status: run.status, conclusion: run.conclusion,
      jobs: [...latest.values()].sort((a, b) => a.name < b.name ? -1 : 1).map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })) }
  })
}
