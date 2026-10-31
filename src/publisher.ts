import { GitHub } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { snapshot, validateScope, type Snapshot } from "./snapshot.ts"
import { CONTRACT_VERSION, Stop, LABELS, MODELS, assessment, eligible, digest, canonical, type Assessment, type Config, type Document, type Phase } from "./policy.ts"

export interface Provenance { model: string, session: string, verified_tools: true }
export class Publisher {
  constructor(private api: GitHub, private config: Config, private checkpoints: Checkpoints) {}
  async fresh(snap: Snapshot) {
    const current = await snapshot(this.api, this.config, this.checkpoints, snap.item.number)
    if (current.fingerprint !== snap.fingerprint || canonical(current.ci) !== canonical(snap.ci)) throw new Stop("publication inputs changed; discard stale result")
    return current
  }
  async invalidate(item: Document) {
    eligible(item, this.config)
    if (item.labels.some((label: Document) => label.name === "review-ready")) await this.api.mutate("DELETE", `/issues/${item.number}/labels/review-ready`)
  }
  async publish(snap: Snapshot, raw: Assessment, phase: Phase, sessions: Provenance[]) {
    let result = assessment(raw, phase)
    const expected = [MODELS.completeness, ...(phase === "final" ? [MODELS.final] : [])]
    if (canonical(sessions.map(s => s.model)) !== canonical(expected) || sessions.some(s => s.verified_tools !== true) || new Set(sessions.map(s => s.session)).size !== expected.length) throw new Stop("Publication requires verified selected-model sessions and evidence tools")
    result = validateScope(result, snap, this.config, this.checkpoints)
    let current = await this.fresh(snap)
    const n = snap.item.number, sha = snap.pr?.head.sha ?? null
    if (["continue", "ready"].includes(result.state) && !snap.pr) throw new Stop("issue cannot become PR-ready")
    const criteriaChanged = snap.criteria_changed ?? snap.previous?.criteria_changed ?? false
    const receipt = sha ? `[Commit ${sha.slice(0, 7)}](https://github.com/${this.config.repository}/commit/${sha})` : ""
    const heading = phase === "final" ? "Automated review" : "Automated completeness check"
    const findingsHeading = phase === "completeness" && result.state === "needs-information" ? "Missing prerequisites" : "Findings"
    const security = phase === "final" ? `\n\n**Security: ${result.security}**` : ""
    let owner = { author: "Author", maintainer: "Maintainer", none: "No action required" }[result.next_step.owner]
    if (result.next_step.owner === "maintainer") owner += ` (${this.config.maintainers.map(login => `@${login}`).join(" or ")})`
    const report = [
      `## ${heading}`,
      result.summary,
      `### ${findingsHeading}\n${result.findings.map(f => "- " + f).join("\n")}${security}`,
      `### Next step\n**${owner}:** ${result.next_step.action}`,
      [receipt, "_Automated by [omamail-curator](https://github.com/klaudworks/omamail-curator)._"].filter(Boolean).join(" · "),
    ].join("\n\n")
    const payload = { type: "status", contract_version: CONTRACT_VERSION, repository: this.config.repository, number: n, fingerprint: snap.fingerprint,
      head: sha, base: snap.pr?.base.sha ?? null, phase, assessment: result, sessions, criteria_changed: criteriaChanged, report_hash: digest(report) }
    const body = report + "\n\n" + this.checkpoints.encode(payload)
    if (Buffer.byteLength(body) > 65000) throw new Stop("status checkpoint exceeds GitHub comment size")
    const existing = current.comments.filter(comment => {
      const previous = this.checkpoints.decode(comment, n, "status")
      return previous?.contract_version === CONTRACT_VERSION && previous.fingerprint === snap.fingerprint &&
        previous.phase === phase && canonical(previous.sessions ?? null) === canonical(sessions)
    }).sort((a, b) => b.id - a.id)[0]
    if (!existing || existing.body !== body) {
      await this.fresh(snap)
      await this.api.mutate(existing ? "PATCH" : "POST", existing ? `/issues/comments/${existing.id}` : `/issues/${n}/comments`, { body })
    }
    const wanted = new Set<string>(LABELS.has(result.state) ? [result.state] : [])
    if (result.state === "ready") wanted.add("review-ready")
    if (result.state === "blocked") wanted.add(result.malicious || result.security === "BLOCK" ? "needs-maintainer-decision" : "needs-information")
    current = await this.fresh(snap)
    const actual = new Set<string>(current.item.labels.map((l: Document) => l.name))
    for (const label of [...actual].filter(l => LABELS.has(l) && !wanted.has(l)).sort()) {
      await this.fresh(snap); await this.api.mutate("DELETE", `/issues/${n}/labels/${label}`)
    }
    const missing = [...wanted].filter(l => !actual.has(l)).sort()
    if (missing.length) { await this.fresh(snap); await this.api.mutate("POST", `/issues/${n}/labels`, { labels: missing }) }
    try { await this.fresh(snap) }
    catch (error) { if (error instanceof Stop) await this.invalidate(await this.api.get(`/issues/${n}`)); throw error }
    return { number: n, state: result.state, head: sha, phase }
  }
}
