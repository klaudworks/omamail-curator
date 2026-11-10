import { canonical, type Assessment, type Document, type Phase } from "./policy.ts"
import type { Snapshot } from "./snapshot.ts"
import type { Checkpoints } from "./state.ts"
import type { Finding } from "./findings.ts"

export function reviewInput(snap: Snapshot, checkpoints: Checkpoints) {
  return { title: snap.item.title, body: snap.item.body ?? "", author: snap.item.user.login, head: snap.pr?.head.sha ?? null, base: snap.pr?.base.sha ?? null,
    discussion: snap.events.filter(e => !checkpoints.decode(e, snap.item.number) && e.user?.type !== "Bot").map<Document>(e => ({
      ...Object.fromEntries(["id", "body", "updated_at", "state", "commit_id", "path", "line", "original_line", "diff_hunk", "in_reply_to_id", "html_url"].map(k => [k, e[k] ?? null])),
      user: { login: e.user?.login ?? null, type: e.user?.type ?? null },
    })) }
}
export type ReviewInput = ReturnType<typeof reviewInput>
export function discussionChanges(before: Document[], after: Document[]) {
  const old = new Map(before.map(e => [e.id, e])), current = new Map(after.map(e => [e.id, e]))
  return { added: after.filter(e => !old.has(e.id)), edited: after.filter(e => old.has(e.id) && canonical(old.get(e.id)) !== canonical(e)).map(e => ({ before: old.get(e.id), after: e })), removed: before.filter(e => !current.has(e.id)) }
}
export function links(value: ReviewInput) {
  const text = [value.title, value.body, ...value.discussion.map(e => e.body)].join("\n")
  return [...new Set(text.match(/https?:\/\/[^\s<>"\\)]+/g) ?? [])].sort()
}
export const sameSource = (before: ReviewInput, after: ReviewInput) => (["title", "body", "author", "head", "base"] as const).every(k => canonical(before[k]) === canonical(after[k]))

export interface ReviewBasis {
  fingerprint: string; input: ReviewInput; ci: Snapshot["ci"]; anchor: number | null; anchor_hash: string | null
}
export const reviewBasis = (snap: Snapshot, checkpoints: Checkpoints): ReviewBasis => ({ fingerprint: snap.fingerprint, input: reviewInput(snap, checkpoints), ci: snap.ci,
  anchor: snap.status_comment?.id ?? null, anchor_hash: snap.previous?.report_hash ?? null })

export interface DiscussionRecheck { fingerprint: string; question: string; added: number[]; decision: Document }
export interface PublicationContext { assessment_fingerprint: string; discussion_recheck?: DiscussionRecheck; findings?: Finding[]; assessed_ci?: Snapshot["ci"] }

export function changeContext(before: ReviewInput | null, current: ReviewInput, previous: { assessment: Assessment; phase: Phase } | null, findings: Finding[] = []) {
  return { previous_assessment: previous?.assessment ?? null, previous_phase: previous?.phase ?? null, last_fully_reviewed: before,
    current: { ...current, discussion: before ? "Apply discussion_changes to last_fully_reviewed.discussion; unchanged comments are not duplicated." : current.discussion },
    discussion_changes: before ? discussionChanges(before.discussion, current.discussion) : null,
    workflow: { stage: current.head ? "review" : "triage", findings,
      outstanding_questions: previous?.assessment.blockers ?? [], next_step: previous?.assessment.next_step ?? null } }
}
export type ChangeContext = ReturnType<typeof changeContext> & { code?: Document; routing?: { stage: Phase; reason: string } }

// Lossless delta encoding for the small decider. The reviewer still receives
// the ordinary context; no old discussion or changed text is truncated.
export function decisionContext(context: ChangeContext) {
  const before = context.last_fully_reviewed
  if (!before) return context
  const current: Document = { discussion: context.current.discussion }
  const unchanged: string[] = []
  for (const key of ["title", "body", "author", "head", "base"] as const) {
    if (canonical(before[key]) === canonical(context.current[key])) unchanged.push(key)
    else current[key] = context.current[key]
  }
  return { ...context, current: { ...current, unchanged_fields: unchanged },
    encoding: "current.unchanged_fields retain their exact last_fully_reviewed values. Apply discussion_changes to its discussion; edited.before is the entry with the same id.",
    discussion_changes: context.discussion_changes && { ...context.discussion_changes,
      edited: context.discussion_changes.edited.map(e => ({ id: e.after.id, after: e.after })) } }
}
