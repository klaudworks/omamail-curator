import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { parseArgs } from "node:util"
import { GitHub, GitHubBackoff, GitHubTransient } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { Relevance, type Completed } from "./relevance.ts"
import { Publisher, type Provenance } from "./publisher.ts"
import { snapshot, validateScope, type Snapshot } from "./snapshot.ts"
import { collect } from "./evidence.ts"
import { reviewBasis } from "./changes.ts"
import { updateFindings } from "./findings.ts"
import { ciSummary, compatibleCI, validateCI } from "./ci.ts"
import { run } from "./io.ts"
import { contractVersion, MODELS, Pause, Stop, assessment, eligible, readConfig, type Config, type Phase } from "./policy.ts"

async function model(config: Config, files: Record<string, string>, phase: Phase, logdir: string) {
  const response = await run([...config.transport], { input: JSON.stringify({ phase, host_time: Date.now() / 1000, files }) })
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
  const relevance = new Relevance(config, checkpoints)
  let snap: Snapshot
  try { snap = await snapshot(api, config, checkpoints, number) }
  catch (error) {
    if (error instanceof Stop) {
      const item = await api.get(`/issues/${number}`)
      try { eligible(item, config); if (!dryRun && !gateOnly) await publisher.invalidate(item) } catch (failure) { if (!(failure instanceof Stop)) throw failure }
    }
    throw error
  }
  if (gateOnly) return { number, gate: "eligible", ci: snap.ci, models_started: 0 }
  const finish = async (completed: Completed, comment?: boolean) => {
    // Save model work before any publication or secondary decision can fail.
    completed = { ...completed, basis: completed.basis ?? reviewBasis(snap, checkpoints) }
    await relevance.retain(snap, completed, comment)
    const current = await snapshot(api, config, checkpoints, number)
    const reconciled = await relevance.reconcile(current, completed)
    if (!reconciled) throw new Stop("publication inputs changed materially; retained result cannot be reused")
    completed = reconciled
    snap = { ...current, criteria_changed: snap.criteria_changed }
    comment ??= await relevance.commentNeeded(snap, completed.assessment)
    await relevance.retain(snap, completed, comment)
    const published = await publisher.publish(snap, completed.assessment, completed.phase, completed.sessions, comment,
      { assessment_fingerprint: completed.basis!.fingerprint, discussion_recheck: completed.discussion_recheck, findings: completed.findings, assessed_ci: completed.basis!.ci })
    await relevance.remember(snap, await publisher.fresh(snap, completed.assessment.state === "deferred"), completed)
    return { ...published, comment_published: comment }
  }
  const pending = await relevance.pending(snap)
  if (pending && !dryRun) {
    const reusable = await relevance.reconcile(snap, { ...pending, basis: pending.basis ?? reviewBasis(snap, checkpoints) })
    if (reusable) {
      return { ...await finish(reusable, pending.comment), reused: true, models_started: 0 }
    }
  }
  if (snap.previous?.contract_version === contractVersion(!!snap.pr) && snap.previous.fingerprint === snap.fingerprint) {
    const completed = await relevance.restore(snap, { assessment: snap.previous.assessment, phase: snap.previous.phase, sessions: snap.previous.sessions, findings: snap.previous.tracked_findings })
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
  if (!dryRun && snap.pr && (snap.previous?.contract_version !== contractVersion(true) || snap.previous?.head !== snap.pr.head.sha || snap.previous?.base !== snap.pr.base.sha || !compatibleCI(snap.previous?.assessed_ci ?? null, snap.ci))) await publisher.invalidate(snap.item)
  const { context, ...decision } = await relevance.decide(api, snap, dryRun)
  if (!decision.review) {
    if (!dryRun && snap.pr) await publisher.progress(snap, `Previous assessment retained; reviewed commit ${(snap.previous?.head ?? "unknown").slice(0, 7)}. CI: ${ciSummary(snap.ci)}`)
    return { number, state: "unchanged", ...decision, models_started: 0 }
  }
  await publisher.fresh(snap)
  if (!dryRun) await publisher.invalidate(snap.item)
  if (!dryRun) await publisher.progress(snap, "Reviewing essential inputs, then investigating if assessable. CI does not delay review.")
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  const logdir = path.join(config.state_dir, "runs", `${stamp}-${number}-${randomBytes(3).toString("hex")}`)
  await mkdir(logdir, { recursive: true, mode: 0o700 })
  const temp = await mkdtemp(path.join(logdir, "evidence-"))
  try {
    const files = await collect(snap, config, temp, checkpoints, api, context)
    await publisher.fresh(snap)
    const phase: Phase = snap.pr ? "review" : "completeness"
    const reviewed = await model(config, files, phase, logdir)
    if (snap.pr) validateCI(reviewed.result, snap.ci)
    const result = validateScope(reviewed.result, snap, config, checkpoints)
    const findings = snap.pr ? updateFindings(context.workflow.findings, reviewed.result, snap.pr.head.sha) : undefined
    const sessions = [reviewed.provenance]
    const output = { number, phase, assessment: result, sessions, findings, models_started: 1 }
    await writeFile(path.join(logdir, "result.json"), JSON.stringify(output, null, 2))
    return dryRun ? { ...output, dry_run: true, relevance: decision } : { ...await finish({ assessment: result, phase, sessions, findings, basis: reviewBasis(snap, checkpoints) }), models_started: 1, relevance: decision }
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
