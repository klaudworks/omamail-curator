import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import { Effect, References, Schema } from "effect"
import { review } from "../reviewer/host.ts"
import { MODELS, Pause, assessment } from "./policy.ts"
import { guides, SYSTEM } from "./prompts.ts"

const Request = Schema.Struct({ phase: Schema.Literals(["completeness", "final"]), host_time: Schema.Number,
  files: Schema.Record(Schema.String, Schema.String), luna: Schema.optional(Schema.Unknown) })

async function inventory(root: string, relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) Object.assign(result, await inventory(root, name))
    else if (entry.isFile()) result[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")
    else result[name] = "link/special"
  }
  return result
}

export async function guest(input: unknown) {
  process.umask(0o077)
  const request = Schema.decodeUnknownSync(Request)(input, { onExcessProperty: "error" })
  if (Math.abs(Date.now() / 1000 - request.host_time) > 120) throw new Pause("Guest clock drift exceeds 120 seconds")
  const parent = path.join(homedir(), ".local/state/omamail-curator/jobs")
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const job = await mkdtemp(path.join(parent, "review-"))
  const abort = new AbortController()
  const stop = () => abort.abort()
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, stop)
  try {
    const evidence = path.join(job, "evidence"), work = path.join(job, "work"), data = path.join(job, "data")
    for (const folder of [evidence, work, path.join(data, "shell"), path.join(data, "tool-output")]) await mkdir(folder, { recursive: true })
    let total = 0
    const target = (name: string) => {
      const value = path.resolve(evidence, name)
      if (!value.startsWith(evidence + "/") || name.includes("\0")) throw new Pause("Unsafe evidence path")
      return value
    }
    for (const [name, encoded] of Object.entries(request.files)) {
      const file = target(name)
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Pause("Invalid evidence encoding")
      const bytes = Buffer.from(encoded, "base64")
      total += bytes.length
      if (total > 128 * 1024 * 1024) throw new Pause("Evidence limit exceeded")
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes)
    }
    if (request.files["source-executables.json"]) {
      const names = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(await readFile(target("source-executables.json"), "utf8")))
      for (const name of names) { if (!Object.hasOwn(request.files, name)) throw new Pause("Unsafe executable manifest"); await chmod(target(name), 0o755) }
    }
    if (request.luna) await writeFile(target("luna.json"), JSON.stringify(request.luna, null, 2))
    for (const name of ["head", "base"]) if (Object.keys(request.files).some(f => f.startsWith(name + "/"))) await cp(target(name), path.join(work, name), { recursive: true })
    const before = await inventory(work)
    const root = `/curator-review-${randomUUID()}`
    const sandbox = { root, evidence, work, data, bun: path.dirname(path.dirname(process.execPath)),
      node: process.env.CURATOR_NODE_ROOT ?? path.join(homedir(), ".local/share/mise/installs/node/26.12.0"),
      toolchain: process.env.CURATOR_TOOLCHAIN ?? path.join(homedir(), ".local/share/omamail-curator/toolchain") }
    const result = await Effect.runPromise(Effect.scoped(review({ sandbox,
      database: process.env.CURATOR_DATABASE ?? path.join(homedir(), ".local/share/opencode/opencode.db"),
      guides: await guides(), system: SYSTEM, phase: request.phase, model: MODELS[request.phase],
      prompt: `Stage: ${request.phase}. Start at REVIEW.md. Read input.json, then follow the applicable stage guide.\nEvidence root (default directory): ${root}/evidence. Writable diagnostic copies: ${root}/work/head and ${root}/work/base. These copies persist across native tool calls in this stage. Run diagnostics with shell workdir set to the appropriate copy. The VM sandbox has no network or credentials; installed Rust, Node, Bun and offscreen/software Qt tooling are available. Report diagnostic modifications and their effect on conclusions. Check optional paths with glob before read. ${request.luna ? "Luna's non-authoritative assessment is available as luna.json." : ""}`,
    })).pipe(Effect.provideService(References.CurrentLoggers, new Set())), { signal: abort.signal })
    const messages = result.messages.messages
    const assistants = messages.filter(m => m.type === "assistant")
    const expected = MODELS[request.phase]
    if (!assistants.length || assistants.some(m => m.error || `${m.model.providerID}/${m.model.id}#${m.model.variant}` !== expected)) throw new Pause("Model turn failed or used an unexpected model")
    const final = assistants.at(-1)!
    if (final.finish !== "stop") throw new Pause("Model did not finish normally")
    const texts = final.content.filter(c => c.type === "text").map(c => c.text)
    const output = assessment(JSON.parse(texts.at(-1) ?? ""), request.phase)
    const tools = assistants.flatMap(m => m.content.filter(c => c.type === "tool"))
    const inspected = new Set(tools.filter(t => t.name === "read" && t.state.status === "completed")
      .map(t => path.relative(`${root}/evidence`, path.resolve(`${root}/evidence`, String((t.state as { input: Record<string, unknown> }).input.path)))))
    const item = JSON.parse(await readFile(target("input.json"), "utf8"))
    const criteria = ["base/AGENTS.md", ...(item.pr ? ["base/CONTRIBUTING.md"] : [])].filter(n => Object.hasOwn(request.files, n))
    if (["input.json", ...criteria].some(name => !inspected.has(name))) throw new Pause("Required evidence was not inspected through native read")
    const pages = new Set(tools.filter(t => t.name === "curator_guide" && t.state.status === "completed").map(t => (t.state as { input: Record<string, unknown> }).input.page))
    const required = ["REVIEW.md", "REPORT.md", item.pr ? "PRS.md" : "ISSUES.md", ...(item.pr ? ["EVIDENCE.md"] : [])]
    if (required.some(page => !pages.has(page))) throw new Pause("Required runtime guides were not read")
    if (tools.some(t => t.state.status !== "completed") && ["continue", "ready"].includes(output.state)) throw new Pause("Tool failure cannot yield a passing gate")
    const after = await inventory(work)
    const modified = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort()
    return { ok: true, model: expected, session: result.session.id, assessment: output, tool_count: tools.length,
      verified_tools: true, runtime: "opencode-v2-workspace-bubblewrap", modified_scratch_paths: modified.slice(0, 200), events: messages }
  } finally {
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.off(signal, stop)
    await rm(job, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await guest(JSON.parse(await Bun.stdin.text())))) }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })); process.exitCode = 1 }
}
