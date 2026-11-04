import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { parseArgs } from "node:util"
import { GitHub, GitHubBackoff, GitHubTransient } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { Completeness } from "./completeness.ts"
import { Relevance, type Completed } from "./relevance.ts"
import { Publisher, type Provenance } from "./publisher.ts"
import { snapshot, validateScope, type Snapshot } from "./snapshot.ts"
import { collect, updateEvidenceCI } from "./evidence.ts"
import { reviewBasis } from "./changes.ts"
import { run } from "./io.ts"
import { contractVersion, MODELS, Pause, Stop, CIWait, assessment, eligible, readConfig, type Config, type Phase, type Assessment } from "./policy.ts"

async function model(config: Config, files: Record<string, string>, phase: Phase, logdir: string, completeness?: Assessment) {
  const response = await run([...config.transport], { input: JSON.stringify({ phase, host_time: Date.now() / 1000, files, completeness }) })
  await writeFile(path.join(logdir, `${phase}-transport.log`), response.stderr)
  let result
  try { result = JSON.parse(response.stdout.toString()) } catch { throw new Pause("Guest transport returned no valid result") }
  await writeFile(path.join(logdir, `${phase}.json`), JSON.stringify(result, null, 2))
  if (response.code || !result.ok) throw new Pause(`Guest/model error: ${String(result.error ?? "transport failed").slice(0, 2000)}`)
  if (result.model !== MODELS[phase] || !result.session?.startsWith("ses_") || result.verified_tools !== true) throw new Pause("Invalid model/session identity")
  const provenance: Provenance = { model: MODELS[phase], session: result.session, verified_tools: true }
  return { result: assessment(result.assessment, phase), provenance }
}

export async function processItem(api: GitHub, config: Config, checkpoints: Checkpoints, number: number, dryRun = false, gateOnly = false) {
  const publisher = new Publisher(api, config, checkpoints)
  const passes = new Completeness(config)
  const relevance = new Relevance(config, checkpoints)
  let snap: Snapshot
  try { snap = await snapshot(api, config, checkpoints, number, false, !gateOnly, gateOnly) }
  catch (error) {
    if (error instanceof Stop) {
      const item = await api.get(`/issues/${number}`)
      try { eligible(item, config); if (!dryRun && !gateOnly) await publisher.invalidate(item) } catch (failure) { if (!(failure instanceof Stop)) throw failure }
    }
    throw error
  }
  if (gateOnly) return { number, gate: "eligible", ci: snap.ci, models_started: 0 }
  const finalGate = async (polling = false) => {
    try { snap = await publisher.fresh(snap, false, true, polling) }
    catch (error) {
      if (error instanceof Stop && !dryRun) await publisher.invalidate(await api.get(`/issues/${number}`))
      if (error instanceof CIWait && !dryRun) await publisher.progress(snap, error.progress)
      throw error
    }
  }
  const finish = async (completed: Completed, comment?: boolean) => {
    // Save model work before any publication or secondary decision can fail.
    completed = { ...completed, basis: completed.basis ?? reviewBasis(snap, checkpoints) }
    await relevance.retain(snap, completed, comment)
    const current = await snapshot(api, config, checkpoints, number, false, false, completed.phase === "final")
    const reconciled = await relevance.reconcile(current, completed)
    if (!reconciled) throw new Stop("publication inputs changed materially; retained result cannot be reused")
    completed = reconciled
    snap = { ...current, criteria_changed: snap.criteria_changed }
    comment ??= await relevance.commentNeeded(snap, completed.assessment)
    await relevance.retain(snap, completed, comment)
    const published = await publisher.publish(snap, completed.assessment, completed.phase, completed.sessions, comment,
      { assessment_fingerprint: completed.basis!.fingerprint, discussion_recheck: completed.discussion_recheck })
    await relevance.remember(snap, await publisher.fresh(snap, completed.assessment.state === "deferred"), completed)
    return { ...published, comment_published: comment }
  }
  const pending = await relevance.pending(snap)
  if (pending && !dryRun) {
    if (pending.phase === "final" && !pending.basis) await finalGate()
    const reusable = await relevance.reconcile(snap, { ...pending, basis: pending.basis ?? reviewBasis(snap, checkpoints) })
    if (reusable) {
      if (reusable.phase === "final") await finalGate()
      return { ...await finish(reusable, pending.comment), reused: true, models_started: 0 }
    }
  }
  if (snap.previous?.contract_version === contractVersion(!!snap.pr) && snap.previous.fingerprint === snap.fingerprint && !await relevance.needsEvidenceReview(snap)) {
    if (snap.previous.phase === "final") await finalGate(true)
    const completed = await relevance.restore(snap, { assessment: snap.previous.assessment, phase: snap.previous.phase, sessions: snap.previous.sessions })
    if (completed) {
      if (dryRun) return { number, state: "unchanged", models_started: 0 }
      if (!pending && publisher.settled(snap, completed.assessment, completed.phase, completed.sessions) &&
        await relevance.remembered(snap, completed) && await relevance.reconcile(snap, completed)) {
        return { number, state: "unchanged", phase: completed.phase, reused: true, comment_published: false, models_started: 0 }
      }
      return { ...await finish(completed, true), reused: true, models_started: 0 }
    }
  }
  // Never leave a new commit labelled as fully reviewed merely because the
  // relevance decision is pending or says that another assessment is unnecessary.
  if (!dryRun && snap.pr && (snap.previous?.head !== snap.pr.head.sha || snap.previous?.base !== snap.pr.base.sha)) await publisher.invalidate(snap.item)
  let retained = await passes.load(snap)
  const { context, ...decision } = await relevance.decide(api, snap, dryRun, retained?.result ?? null)
  if (!decision.review) {
    if (snap.pr && snap.previous?.phase === "final") await finalGate(true)
    return { number, state: "unchanged", ...decision, models_started: 0 }
  }
  await publisher.fresh(snap)
  if (retained && decision.stage === "completeness") {
    if (!dryRun) await passes.invalidate(snap)
    retained = null
  }
  if (retained) await finalGate()
  if (!dryRun) await publisher.invalidate(snap.item)
  if (!dryRun) await publisher.progress(snap, retained ? "Reviewing the current changes." : "Checking completeness.")
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  const logdir = path.join(config.state_dir, "runs", `${stamp}-${number}-${randomBytes(3).toString("hex")}`)
  await mkdir(logdir, { recursive: true, mode: 0o700 })
  const temp = await mkdtemp(path.join(logdir, "evidence-"))
  try {
    const files = await collect(snap, config, temp, checkpoints, api, context)
    await publisher.fresh(snap)
    const completeness = retained ?? await model(config, files, "completeness", logdir)
    let result = validateScope(completeness.result, snap, config, checkpoints), phase: Phase = "completeness"
    const sessions = [completeness.provenance]
    if (result.state === "continue") {
      if (!snap.pr) throw new Pause("Issue incorrectly requested PR review")
      if (!dryRun && !retained) await passes.save(snap, result, completeness.provenance)
      if (!dryRun) await publisher.completenessPassed(snap, result, completeness.provenance)
      try { await finalGate() }
      catch (error) {
        if (!(error instanceof Stop)) throw error
        const stopped = { number, state: "stopped", reason: error.message, completeness_passed: true, models_started: retained ? 0 : 1, ...(dryRun ? { dry_run: true } : {}) }
        await writeFile(path.join(logdir, "result.json"), JSON.stringify({ ...stopped, phase, assessment: result, sessions }, null, 2))
        return stopped
      }
      updateEvidenceCI(files, snap)
      if (!dryRun) await publisher.progress(snap, "Completeness passed; reviewing the current changes.")
      const final = await model(config, files, "final", logdir, result)
      if (final.provenance.session === completeness.provenance.session) throw new Pause("Final review must use a fresh session")
      result = validateScope(final.result, snap, config, checkpoints); phase = "final"; sessions.push(final.provenance)
    }
    const output = { number, phase, assessment: result, sessions, completeness_reused: !!retained }
    await writeFile(path.join(logdir, "result.json"), JSON.stringify(output, null, 2))
    return dryRun ? { ...output, dry_run: true, relevance: decision } : { ...await finish({ assessment: result, phase, sessions, basis: reviewBasis(snap, checkpoints) }), relevance: decision }
  } finally { await rm(temp, { recursive: true, force: true }) }
}

async function main() {
  process.umask(0o077)
  const { values } = parseArgs({ options: { config: { type: "string" }, item: { type: "string" }, "dry-run": { type: "boolean" }, "gate-only": { type: "boolean" }, locked: { type: "boolean" } } })
  if (!values.config) throw new Pause("--config is required")
  const config = readConfig(JSON.parse(await readFile(values.config, "utf8")))
  await mkdir(config.state_dir, { recursive: true, mode: 0o700 })
  if (!values.locked) {
    // Kernel flock releases on crashes and serializes old and new deployments.
    const child = Bun.spawn(["flock", "-n", "-E", "75", path.join(config.state_dir, "sweep.lock"), process.execPath, import.meta.path, ...process.argv.slice(2), "--locked"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" })
    const code = await child.exited
    if (code === 75) console.log(JSON.stringify({ state: "another sweep is active" }))
    else process.exitCode = code
    return
  }
  const keyfile = path.join(config.state_dir, "checkpoint.key")
  try { await writeFile(keyfile, randomBytes(32), { flag: "wx", mode: 0o600 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  if ((await stat(config.token_file)).mode & 0o077) throw new Pause("Token file must be private (0600)")
  const api = new GitHub((await readFile(config.token_file, "utf8")).trim(), config.repository, config.state_dir)
  try {
    if ((await api.request("GET", "/user")).login?.toLowerCase() !== config.publisher_login) throw new Pause("Token identity does not match configured publisher")
    const checkpoints = new Checkpoints(await readFile(keyfile), config.repository, config.publisher_login)
    const number = values.item === undefined ? undefined : Number(values.item)
    if (number !== undefined && (!Number.isSafeInteger(number) || number <= 0)) throw new Pause("Invalid item number")
    const items = number ? [{ number }] : await api.pages("/issues?state=open&sort=created&direction=asc")
    for (const item of items) {
      if (!number) { try { eligible(item, config) } catch (error) { if (error instanceof Stop) continue; throw error } }
      try { console.log(JSON.stringify(await processItem(api, config, checkpoints, item.number, values["dry-run"], values["gate-only"]))) }
      catch (error) {
        if (!(error instanceof Stop) && !(error instanceof GitHubTransient)) throw error
        console.log(JSON.stringify({ number: item.number, state: error instanceof GitHubTransient ? "retry-later" : "stopped", reason: error.message }))
      }
    }
  } finally {
    console.log(JSON.stringify({ state: "github-usage", ...api.usage, rate_limit: api.rateLimit }))
  }
}
if (import.meta.main) main().catch(error => {
  console.log(JSON.stringify({ state: error instanceof GitHubBackoff ? "backoff" : "paused", reason: error instanceof Error ? error.message : String(error),
    ...(error instanceof GitHubBackoff ? { retry_at: new Date(error.until).toISOString() } : {}) }))
  process.exitCode = error instanceof GitHubBackoff ? 0 : 1
})
