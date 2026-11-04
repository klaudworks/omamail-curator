import { GitHub } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { snapshot, validateScope, type Snapshot } from "./snapshot.ts"
import type { PublicationContext } from "./changes.ts"
import { contractVersion, Stop, LABELS, ISSUE_LABELS, MODELS, assessment, eligible, digest, canonical, type Assessment, type Config, type Document, type Phase } from "./policy.ts"

export interface Provenance { model: string, session: string, verified_tools: true }
export class Publisher {
  constructor(private api: GitHub, private config: Config, private checkpoints: Checkpoints) {}
  async progress(snap: Snapshot, message: string, create = true) {
    if (!snap.pr) return
    const current = await this.fresh(snap, false, false)
    const n = snap.item.number, sha = snap.pr.head.sha
    const existing = current.comments.filter(c => this.checkpoints.decode(c, n, "progress")).sort((a, b) => b.id - a.id)[0]
    if (!create && !existing) return
    const report = `**Curator:** ${message}\n\n[Commit ${sha.slice(0, 7)}](https://github.com/${this.config.repository}/commit/${sha}) · _Automated by [omamail-curator](https://github.com/klaudworks/omamail-curator)._`
    if (existing && this.checkpoints.decode(existing, n, "progress")?.report_hash === digest(report)) return
    const body = report + "\n\n" + this.checkpoints.encode({ type: "progress", repository: this.config.repository, number: n, head: sha, report_hash: digest(report) })
    await this.fresh(snap, false, false)
    await this.api.mutate(existing ? "PATCH" : "POST", existing ? `/issues/comments/${existing.id}` : `/issues/${n}/comments`, { body })
    await this.fresh(snap, false, false)
  }
  async fresh(snap: Snapshot, allowDeferred = false, requireCI = snap.ci_checked, polling = false) {
    const current = await snapshot(this.api, this.config, this.checkpoints, snap.item.number, allowDeferred, polling, requireCI)
    if (current.fingerprint !== snap.fingerprint || requireCI && snap.ci_checked && canonical(current.ci) !== canonical(snap.ci)) throw new Stop("publication inputs changed; discard stale result")
    return current
  }
  async invalidate(item: Document) {
    eligible(item, this.config)
    if (item.labels.some((label: Document) => label.name === "review-ready")) await this.api.mutate("DELETE", `/issues/${item.number}/labels/review-ready`)
  }
  async completenessPassed(snap: Snapshot, raw: Assessment, session: Provenance) {
    const result = validateScope(assessment(raw, "completeness"), snap, this.config, this.checkpoints)
    if (!snap.pr || result.state !== "continue" || session.model !== MODELS.completeness || session.verified_tools !== true || !session.session?.startsWith("ses_")) throw new Stop("Label transition requires verified passing PR completeness")
    const current = await this.fresh(snap)
    if (current.item.labels.some((label: Document) => label.name === "needs-information")) await this.api.mutate("DELETE", `/issues/${snap.item.number}/labels/needs-information`)
  }
  private validated(snap: Snapshot, raw: Assessment, phase: Phase, sessions: Provenance[]) {
    const result = assessment(raw, phase)
    if (phase === "final" && (!snap.pr || !snap.ci_checked)) throw new Stop("Final publication requires successful current-head CI")
    const expected = [MODELS.completeness, ...(phase === "final" ? [MODELS.final] : [])]
    if (canonical(sessions.map(s => s.model)) !== canonical(expected) || sessions.some(s => s.verified_tools !== true) || new Set(sessions.map(s => s.session)).size !== expected.length) throw new Stop("Publication requires verified selected-model sessions and evidence tools")
    return validateScope(result, snap, this.config, this.checkpoints)
  }
  private labels(snap: Snapshot, result: Assessment) {
    const wanted = new Set<string>(LABELS.has(result.state) ? [result.state] : [])
    if (result.state === "ready") wanted.add("review-ready")
    if (result.state === "blocked") wanted.add("review-blocked")
    const managed = new Set(LABELS)
    if (!snap.pr) {
      wanted.add(ISSUE_LABELS[result.kind])
      for (const label of Object.values(ISSUE_LABELS)) managed.add(label)
      if (result.state === "declined") wanted.add("wontfix")
      if (result.state === "deferred") wanted.add("deferred")
      // Only remove a disposition label previously applied by this curator.
      if (snap.previous?.assessment.state === "declined") managed.add("wontfix")
    }
    const actual = new Set<string>(snap.item.labels.map((l: Document) => l.name))
    return { remove: [...actual].filter(l => managed.has(l) && !wanted.has(l)).sort(), add: [...wanted].filter(l => !actual.has(l)).sort() }
  }
  settled(snap: Snapshot, raw: Assessment, phase: Phase, sessions: Provenance[]) {
    const labels = this.labels(snap, this.validated(snap, raw, phase, sessions))
    return !labels.remove.length && !labels.add.length
  }
  async publish(snap: Snapshot, raw: Assessment, phase: Phase, sessions: Provenance[], comment = true, context?: PublicationContext) {
    const result = this.validated(snap, raw, phase, sessions)
    let current = await this.fresh(snap)
    const n = snap.item.number, sha = snap.pr?.head.sha ?? null
    const version = contractVersion(!!snap.pr)
    if (["continue", "ready"].includes(result.state) && !snap.pr) throw new Stop("issue cannot become PR-ready")
    if (!comment && (snap.pr || !snap.previous || snap.previous.contract_version !== version)) throw new Stop("Only issue follow-ups may omit a redundant comment")
    const criteriaChanged = snap.criteria_changed ?? snap.previous?.criteria_changed ?? false
    const receipt = sha ? `[Commit ${sha.slice(0, 7)}](https://github.com/${this.config.repository}/commit/${sha})` : ""
    const heading = !snap.pr ? "Automated issue triage" : phase === "final" ? "Automated review" : "Automated completeness check"
    const findingsHeading = phase === "completeness" && result.state === "needs-information" ? snap.pr ? "Missing prerequisites" : "Missing information" : "Findings"
    const security = phase === "final" ? `\n\n**Security: ${result.security}**` : ""
    let owner = { author: "Author", maintainer: "Maintainer", none: "No action required" }[result.next_step.owner]
    if (result.next_step.owner === "author") owner += ` (@${snap.item.user.login})`
    if (result.next_step.owner === "maintainer") owner += ` (${this.config.maintainers.map(login => `@${login}`).join(" or ")})`
    const footer = "_Automated by [omamail-curator](https://github.com/klaudworks/omamail-curator)._"
    const prompt = result.author_prompt ? `Copy this prompt to your coding agent:\n\n\`\`\`text\n${result.author_prompt}\n\nUpdate https://github.com/${this.config.repository}/issues/${n} with the findings using gh issue comment https://github.com/${this.config.repository}/issues/${n} --body-file <report-file>. Upload any screenshots through GitHub attachments first and include their returned URLs; gh issue comment does not upload local images.\n\`\`\`` : ""
    const mentions = result.next_step.owner === "author" ? `@${snap.item.user.login}, ` : result.next_step.owner === "maintainer" ? `${this.config.maintainers.map(login => `@${login}`).join(" or ")}, ` : ""
    const report = !snap.pr ? [
      [result.summary, ...result.findings].join(" "),
      `${mentions}${result.next_step.action}`,
      prompt, footer,
    ].filter(Boolean).join("\n\n") : [
      `## ${heading}`,
      result.summary,
      `### ${findingsHeading}\n${result.findings.map(f => "- " + f).join("\n")}${security}`,
      `### Next step\n**${owner}:** ${result.next_step.action}`,
      [receipt, footer].filter(Boolean).join(" · "),
    ].join("\n\n")
    const assessmentFingerprint = context?.assessment_fingerprint ?? snap.fingerprint
    if (!/^[a-f0-9]{64}$/.test(assessmentFingerprint) || context?.discussion_recheck && context.discussion_recheck.fingerprint !== snap.fingerprint) throw new Stop("Invalid assessment/publication fingerprint context")
    const payload = { type: "status", contract_version: version, repository: this.config.repository, number: n, fingerprint: snap.fingerprint,
      ...(assessmentFingerprint !== snap.fingerprint ? { assessment_fingerprint: assessmentFingerprint } : {}), ...(context?.discussion_recheck ? { discussion_recheck: {
        fingerprint: context.discussion_recheck.fingerprint, question: context.discussion_recheck.question, added: context.discussion_recheck.added,
        model: context.discussion_recheck.decision.model, can_skip: context.discussion_recheck.decision.answers.can_skip.noul,
      } } : {}),
      head: sha, base: snap.pr?.base.sha ?? null, phase, assessment: result, sessions, criteria_changed: criteriaChanged, report_hash: digest(report) }
    const body = report + "\n\n" + this.checkpoints.encode(payload)
    if (Buffer.byteLength(body) > 65000) throw new Stop("status checkpoint exceeds GitHub comment size")
    const existing = current.comments.filter(comment => {
      const previous = this.checkpoints.decode(comment, n, "status")
      return previous?.contract_version === version && (previous.fingerprint === snap.fingerprint || (previous.assessment_fingerprint ?? previous.fingerprint) === assessmentFingerprint) &&
        previous.phase === phase && canonical(previous.sessions ?? null) === canonical(sessions)
    }).sort((a, b) => b.id - a.id)[0]
    if (comment && (!existing || existing.body !== body)) {
      await this.fresh(snap)
      await this.api.mutate(existing ? "PATCH" : "POST", existing ? `/issues/comments/${existing.id}` : `/issues/${n}/comments`, { body })
    }
    current = await this.fresh(snap)
    const labels = this.labels(current, result)
    for (const label of labels.remove) {
      await this.fresh(snap); await this.api.mutate("DELETE", `/issues/${n}/labels/${label}`)
    }
    if (labels.add.length) { await this.fresh(snap); await this.api.mutate("POST", `/issues/${n}/labels`, { labels: labels.add }) }
    try {
      current = await this.fresh(snap, result.state === "deferred")
      if (snap.pr && current.status_comment) {
        const action = result.state === "ready" ? "Review complete; awaiting the maintainer’s merge decision" :
          result.next_step.owner === "author" ? `Waiting for @${snap.item.user.login}` : "Waiting for a maintainer"
        await this.progress(current, `${action}. See the [assessment](https://github.com/${this.config.repository}/pull/${n}#issuecomment-${current.status_comment.id}).`, false)
      }
    }
    catch (error) { if (error instanceof Stop) await this.invalidate(await this.api.get(`/issues/${n}`)); throw error }
    return { number: n, state: result.state, head: sha, phase }
  }
}
