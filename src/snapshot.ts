import { GitHub } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { Stop, Pause, digest, eligible, authorAllowed, type Config, type Document, type Assessment } from "./policy.ts"
import { observeCI } from "./ci.ts"

export async function snapshot(api: GitHub, config: Config, checkpoints: Checkpoints, number: number, allowDeferred = false) {
  const item = await api.get(`/issues/${number}`)
  eligible(item, config)
  if (!allowDeferred && item.labels.some((l: Document) => l.name === "deferred")) throw new Stop("deferred; a maintainer must remove the deferred label to resume")
  let pr: Document | null = null
  if (item.pull_request) {
    pr = await api.get(`/pulls/${number}`)
    if (!pr) throw new Stop("PR unavailable")
    if (pr.draft) throw new Stop("draft PR")
    if (pr.state !== "open" || !authorAllowed(pr, config, true)) throw new Stop("PR no longer eligible")
  }
  const ci = pr ? await observeCI(api, config, pr) : null
  const comments = await api.pages(`/issues/${number}/comments`)
  const events = [...comments]
  if (pr) events.push(...await api.pages(`/pulls/${number}/reviews`), ...await api.pages(`/pulls/${number}/comments`))
  const [status_comment, previous] = checkpoints.current(comments, number)
  const content = checkpoints.fingerprint(item, pr, events)
  return { item, pr, ci, events, comments, status_comment, previous,
    fingerprint: pr ? digest({ content, ci }) : content, criteria_changed: undefined as boolean | undefined }
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>

export function validateScope(result: Assessment, snap: Snapshot, config: Config, checkpoints: Checkpoints): Assessment {
  if (!snap.pr) return validateIssueScope(result, snap, config, checkpoints)
  if (result.issue_decision || result.author_prompt || ["declined", "deferred"].includes(result.state)) throw new Pause("Issue-only fields on a PR")
  if (!["continue", "ready", "handoff", "needs-information", "needs-maintainer-decision"].includes(result.state)) return result
  const head = snap.pr?.head.sha ?? "issue", previous = snap.previous ?? {}
  const prior = new Set(previous.assessment?.scope_decisions ?? []), accepted = new Set<number>(), rejected = new Set<number>()
  for (const event of snap.events) {
    if (!config.maintainers.includes(event.user?.login?.toLowerCase()) || checkpoints.decode(event, snap.item.number)) continue
    const lines = (event.body ?? "").split(/\r?\n/)
    if (lines.includes(`/curator scope accept ${head}`) || prior.has(event.id) && lines.includes(`/curator scope accept ${previous.head}`)) accepted.add(event.id)
    if (lines.includes(`/curator scope reject ${head}`) || previous.head && lines.includes(`/curator scope reject ${previous.head}`)) rejected.add(event.id)
  }
  const needsAcceptance = result.scope !== "routine" && !result.scope_decisions.some(id => accepted.has(id))
  if (!rejected.size && !needsAcceptance) return result
  const blocker = rejected.size ? "A maintainer has objected to this direction; resolve that objection first." : "A maintainer needs to confirm this change to the product's direction."
  return { ...result, state: "needs-maintainer-decision", findings: result.state === "needs-maintainer-decision" ? result.findings : [blocker, ...result.findings],
    next_step: { owner: "maintainer", action: `${rejected.size ? "Resolve the recorded objection, then" : "Decide whether this direction should proceed, then"} post /curator scope accept ${head} or /curator scope reject ${head} on its own line.` },
    blockers: result.blockers.includes(blocker) ? result.blockers : [...result.blockers, blocker] }
}

function validateIssueScope(result: Assessment, snap: Snapshot, config: Config, checkpoints: Checkpoints): Assessment {
  if (["continue", "ready"].includes(result.state)) throw new Pause("Issue cannot become PR-ready")
  if (result.malicious) return result
  if (result.kind === "bug" && result.state === "needs-information" && (result.next_step.owner !== "author" || !result.author_prompt)) throw new Pause("Bug clarification needs an author-owned copy-paste agent prompt")
  if (result.author_prompt && result.next_step.owner !== "author") throw new Pause("Author prompt requires an author next step")
  const decision = result.issue_decision
  if (result.scope_decisions.length) throw new Pause("Issues cite quoted issue_decision evidence, not PR scope commands")
  if (decision) for (const citation of decision.comments) {
    const event = snap.comments.find(c => c.id === citation.id)
    if (!event || !config.maintainers.includes(event.user?.login?.toLowerCase()) || checkpoints.decode(event, snap.item.number) ||
      !citation.quote.trim() || !event.body?.includes(citation.quote)) throw new Pause("Issue decision needs an exact quote from a configured maintainer comment")
  }
  if (result.state === "declined" && decision?.disposition !== "rejected" || result.state === "deferred" && decision?.disposition !== "deferred") throw new Pause("Issue disposition lacks maintainer evidence")
  if (decision?.disposition === "rejected" && result.state !== "declined" || decision?.disposition === "deferred" && result.state !== "deferred") throw new Pause("Issue assessment must honor the cited maintainer decision")
  if (["declined", "deferred"].includes(result.state) && result.next_step.owner !== "none") throw new Pause("Settled issue decisions must not ask for another decision")
  if (result.state === "handoff" && result.next_step.owner !== "author") throw new Pause("Actionable issues invite the creator to prepare a PR")
  if (result.scope !== "routine" && decision?.disposition !== "accepted" &&
    !["needs-maintainer-decision", "needs-information", "blocked", "verified-fixed", "declined", "deferred"].includes(result.state)) throw new Pause("Non-routine issue needs a supported scope decision")
  return result
}
