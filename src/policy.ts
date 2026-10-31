import { createHash } from "node:crypto"
import { Schema } from "effect"

export class Stop extends Error {}
export class Pause extends Error {}
export type Phase = "completeness" | "final"
export const CONTRACT_VERSION = 9
export const MODELS = { completeness: "openai/gpt-6.1-terra#medium", final: "openai/gpt-6.1-sol#xhigh" }
export const LABELS = new Set(["needs-information", "needs-maintainer-decision", "review-ready"])

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
  publisher_login: Schema.String, token_file: Schema.String, state_dir: Schema.String,
  transport: Schema.Array(Schema.String), pipelines: Schema.Array(Schema.Struct({ path: Schema.String, jobs: Schema.Array(Schema.String) })),
})
export type Config = typeof ConfigSchema.Type
export const readConfig = (value: unknown) => Schema.decodeUnknownSync(ConfigSchema)(value, { onExcessProperty: "error" })

const text = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const AssessmentSchema = Schema.Struct({
  kind: Schema.Literals(["bug", "feature", "disputed", "support"]),
  scope: Schema.Literals(["routine", "fundamental", "uncertain"]),
  state: Schema.Literals(["continue", "needs-information", "needs-maintainer-decision", "blocked", "ready", "handoff", "support", "verified-fixed"]),
  summary: text(20, 400), findings: Schema.Array(text(1, 400)).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  next_step: Schema.Struct({ owner: Schema.Literals(["author", "maintainer", "none"]), action: text(10, 600) }),
  security: Schema.Literals(["PASS", "BLOCK", "NOT VERIFIED"]), blockers: Schema.Array(Schema.String),
  scope_decisions: Schema.Array(Schema.Int), malicious: Schema.Boolean,
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
  return result
}

// GitHub documents are retained intact as evidence. Accessors below fail closed
// on absent gate fields; model output uses the strict schema above.
export type Document = Record<string, any>
export function eligible(item: Document, config: Config) {
  if (item.repository_url !== `https://api.github.com/repos/${config.repository}`) throw new Stop("repository mismatch")
  if (!config.authors.includes(item.user?.login?.toLowerCase())) throw new Stop("author not allowed")
  if (item.state !== "open" || item.locked) throw new Stop("item closed or locked")
}

export function successfulRuns(pr: Document, workflows: Record<string, Document>, config: Config) {
  return config.pipelines.map(spec => {
    const source = workflows[spec.path]
    const candidates = source.runs.filter((run: Document) => run.workflow_id === source.id && run.event === "pull_request" && run.head_sha === pr.head.sha &&
      (run.pull_requests?.length ? run.pull_requests.some((p: Document) => p.number === pr.number) : run.head_repository?.id === pr.head.repo.id && run.head_branch === pr.head.ref))
    const run = candidates.sort((a: Document, b: Document) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0]
    if (!run) throw new Stop(`CI missing: ${spec.path}`)
    if (run.status !== "completed" || run.conclusion !== "success") throw new Stop(`CI not successful: ${spec.path} (${run.status}/${run.conclusion})`)
    const latest = new Map<string, Document>()
    for (const job of source.jobs[String(run.id)] ?? []) if (!latest.has(job.name) || job.id > latest.get(job.name)!.id) latest.set(job.name, job)
    if (!latest.size || [...latest.values()].some(j => j.status !== "completed" || j.conclusion !== "success")) throw new Stop(`CI job missing or unsuccessful: ${spec.path}`)
    for (const pattern of spec.jobs) if (![...latest.keys()].some(name => new RegExp(`^(?:${pattern})$`).test(name))) throw new Stop(`CI expected job missing: ${pattern}`)
    return { path: spec.path, id: run.id, attempt: run.run_attempt, sha: run.head_sha, url: run.html_url, status: run.status, conclusion: run.conclusion,
      jobs: [...latest.values()].sort((a, b) => a.name < b.name ? -1 : 1).map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })) }
  })
}
