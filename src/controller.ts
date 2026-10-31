import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { parseArgs } from "node:util"
import { GitHub } from "./github.ts"
import { Checkpoints } from "./state.ts"
import { Publisher, type Provenance } from "./publisher.ts"
import { snapshot, validateScope } from "./snapshot.ts"
import { collect } from "./evidence.ts"
import { run } from "./io.ts"
import { CONTRACT_VERSION, MODELS, Pause, Stop, assessment, eligible, readConfig, type Config, type Phase, type Assessment } from "./policy.ts"

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
  let snap
  try { snap = await snapshot(api, config, checkpoints, number) }
  catch (error) {
    if (error instanceof Stop) {
      const item = await api.get(`/issues/${number}`)
      try { eligible(item, config); if (!dryRun && !gateOnly) await publisher.invalidate(item) } catch (failure) { if (!(failure instanceof Stop)) throw failure }
    }
    throw error
  }
  if (gateOnly) return { number, gate: "eligible", ci: snap.ci, models_started: 0 }
  if (snap.previous?.contract_version === CONTRACT_VERSION && snap.previous.fingerprint === snap.fingerprint) {
    if (dryRun) return { number, state: "unchanged", models_started: 0 }
    return { ...await publisher.publish(snap, snap.previous.assessment, snap.previous.phase, snap.previous.sessions), reused: true, models_started: 0 }
  }
  if (!dryRun) await publisher.invalidate(snap.item)
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  const logdir = path.join(config.state_dir, "runs", `${stamp}-${number}-${randomBytes(3).toString("hex")}`)
  await mkdir(logdir, { recursive: true, mode: 0o700 })
  const temp = await mkdtemp(path.join(logdir, "evidence-"))
  try {
    const files = await collect(snap, config, temp, checkpoints)
    await publisher.fresh(snap)
    const completeness = await model(config, files, "completeness", logdir)
    let result = validateScope(completeness.result, snap, config, checkpoints), phase: Phase = "completeness"
    const sessions = [completeness.provenance]
    if (result.state === "continue") {
      if (!snap.pr) throw new Pause("Issue incorrectly requested PR review")
      await publisher.fresh(snap)
      const final = await model(config, files, "final", logdir, result)
      if (final.provenance.session === completeness.provenance.session) throw new Pause("Final review must use a fresh session")
      result = final.result; phase = "final"; sessions.push(final.provenance)
    }
    const output = { number, phase, assessment: result, sessions }
    await writeFile(path.join(logdir, "result.json"), JSON.stringify(output, null, 2))
    return dryRun ? { ...output, dry_run: true } : publisher.publish(snap, result, phase, sessions)
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
  const api = new GitHub((await readFile(config.token_file, "utf8")).trim(), config.repository)
  if ((await api.request("GET", "/user")).login?.toLowerCase() !== config.publisher_login) throw new Pause("Token identity does not match configured publisher")
  const checkpoints = new Checkpoints(await readFile(keyfile), config.repository, config.publisher_login)
  const number = values.item === undefined ? undefined : Number(values.item)
  if (number !== undefined && (!Number.isSafeInteger(number) || number <= 0)) throw new Pause("Invalid item number")
  const items = number ? [{ number }] : await api.pages("/issues?state=open&sort=created&direction=asc")
  for (const item of items) {
    if (!number) { try { eligible(item, config) } catch (error) { if (error instanceof Stop) continue; throw error } }
    try { console.log(JSON.stringify(await processItem(api, config, checkpoints, item.number, values["dry-run"], values["gate-only"]))) }
    catch (error) { if (!(error instanceof Stop)) throw error; console.log(JSON.stringify({ number: item.number, state: "stopped", reason: error.message, models_started: 0 })) }
  }
}
if (import.meta.main) main().catch(error => { console.log(JSON.stringify({ state: "paused", reason: error instanceof Error ? error.message : String(error) })); process.exitCode = 1 })
