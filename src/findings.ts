import { Pause, type Assessment, type FindingUpdate } from "./policy.ts"

export interface Finding extends FindingUpdate { first_seen_head: string; assessed_head: string }
export function updateFindings(previous: Finding[], result: Assessment, head: string): Finding[] {
  const updates = result.finding_updates ?? []
  const known = new Map(previous.map(f => [f.id, f]))
  for (const old of previous) if (old.status === "open" && !updates.some(f => f.id === old.id)) throw new Pause(`Open finding ${old.id} was not addressed`)
  let next = Math.max(0, ...previous.map(f => Number(f.id.slice(1)))) + 1
  for (const update of updates) {
    const old = known.get(update.id)
    if (!old && (update.id !== `F${next++}` || update.status !== "open")) throw new Pause("New findings need sequential IDs and open status")
    if (old && update.concern !== old.concern) throw new Pause(`Finding ${old.id} changed identity`)
    if (old && old.status !== update.status && update.evidence === old.evidence) throw new Pause(`Finding ${old.id} changed status without new evidence`)
    known.set(update.id, { ...update, first_seen_head: old?.first_seen_head ?? head, assessed_head: head })
  }
  const all = [...known.values()]
  if (result.state === "ready" && all.some(f => f.status === "open")) throw new Pause("Readiness has unresolved findings")
  if (result.blockers.length && !all.some(f => f.status === "open")) throw new Pause("PR blockers need tracked findings")
  return all
}
