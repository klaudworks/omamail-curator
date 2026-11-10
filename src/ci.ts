import type { GitHub } from "./github.ts"
import { canonical, Pause, type Assessment, type Config, type Document } from "./policy.ts"

export interface CIEntry { key: string; id: number | null; status: string; conclusion: string | null; url: string | null; version: string }
export interface CI { head: string; entries: CIEntry[] }
const adverse = (e: CIEntry) => ["failure", "error", "timed_out", "startup_failure", "stale"].includes(e.conclusion ?? "")
export const ciFailures = (ci: CI | null) => ci?.entries.filter(adverse) ?? []
export const hasNewCIFailure = (before: CI | null, after: CI | null) =>
  ciFailures(after).some(e => !ciFailures(before).some(old => canonical(old) === canonical(e)))
// CI progress must not throw away completed work. New adverse evidence does.
export const compatibleCI = (before: CI | null, after: CI | null) => before?.head === after?.head &&
  !hasNewCIFailure(before, after)

export function validateCI(result: Assessment, ci: CI | null) {
  const failures = ciFailures(ci), judgments = result.ci_assessment ?? []
  if (new Set(judgments.map(j => j.key)).size !== judgments.length || judgments.length !== failures.length || failures.some(f => !judgments.some(j => j.key === f.key))) throw new Pause("Review must assess each reported CI failure")
  if (result.state === "ready" && judgments.some(j => j.relevance !== "unrelated")) throw new Pause("Unresolved relevant or uncertain CI failure cannot yield readiness")
}

export async function observeCI(api: GitHub, config: Config, pr: Document): Promise<CI> {
  const head = pr.head.sha
  const runs = await api.pages(`/actions/runs?event=pull_request&head_sha=${head}`, "workflow_runs")
  const entries: CIEntry[] = config.pipelines.map(spec => {
    const run = runs.filter(r => r.path === spec.path && r.event === "pull_request" && r.head_sha === head &&
      (r.pull_requests?.length ? r.pull_requests.some((p: Document) => p.number === pr.number) : r.head_repository?.id === pr.head.repo.id && r.head_branch === pr.head.ref))
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0]
    return { key: spec.path, id: run?.id ?? null, status: run?.status ?? "missing", conclusion: run?.conclusion ?? null, url: run?.html_url ?? null, version: String(run?.run_attempt ?? "") }
  })
  const checks = await api.pages(`/commits/${head}/check-runs?filter=latest`, "check_runs")
  const statuses = await api.pages(`/commits/${head}/statuses`)
  const latest = new Map<string, CIEntry>()
  for (const c of checks) {
    if (c.head_sha !== head || !Number.isSafeInteger(c.id)) throw new Pause("Invalid current-head CI check")
    const key = `check:${c.app?.id}:${c.name}`, old = latest.get(key)
    if (!old || c.id > old.id!) latest.set(key, { key, id: c.id, status: c.status, conclusion: c.conclusion ?? null, url: c.html_url ?? null, version: c.completed_at ?? "" })
  }
  for (const s of statuses) {
    const key = `status:${s.context}`, old = latest.get(key)
    if (!old || s.id > old.id!) latest.set(key, { key, id: s.id, status: s.state === "pending" ? "in_progress" : "completed", conclusion: s.state === "pending" ? null : s.state, url: s.target_url ?? null, version: s.updated_at ?? "" })
  }
  entries.push(...latest.values())
  return { head, entries: entries.sort((a, b) => a.key.localeCompare(b.key)) }
}

export function ciSummary(ci: CI | null) {
  if (!ci) return "Not applicable."
  const failed = ciFailures(ci)
  if (failed.length) return `Reported failures in ${failed.length} workflow/check entries; see the review's assessment of relevance. CI is not a merge gate for this recommendation.`
  if (ci.entries.some(e => e.conclusion === "action_required")) return "Workflows await maintainer approval; hosted verification is incomplete."
  if (!ci.entries.length || ci.entries.every(e => e.status === "missing")) return "No current-head runs reported; hosted verification is incomplete."
  if (ci.entries.every(e => e.status === "completed" && e.conclusion === "success")) return "All observed configured workflows and checks succeeded."
  return "Hosted verification is incomplete (missing, pending, cancelled or skipped checks); review proceeded using available evidence."
}

export function ciLinks(ci: CI | null) {
  return (ci?.entries ?? []).filter(e => e.key.startsWith(".github/workflows/") && e.url && e.url.startsWith("https://github.com/") && e.conclusion !== "success")
    .map(e => `[${e.key.split("/").at(-1)}](${e.url})`).join(" · ")
}
