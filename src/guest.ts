import { chmod, cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Effect, References, Schema } from "effect"
import type { AssistantTool } from "@opencode/schema/session-message"
import { review } from "../reviewer/host.ts"
import { MODELS, Pause, assessment } from "./policy.ts"
import { guides, requiredGuides, SYSTEM } from "./prompts.ts"

const Request = Schema.Struct({ phase: Schema.Literals(["completeness", "final"]), host_time: Schema.Number,
  files: Schema.Record(Schema.String, Schema.String), completeness: Schema.optional(Schema.Unknown) })

export function expectedSearchMiss(tool: AssistantTool, root: string): boolean {
  if (!["grep", "glob"].includes(tool.name) || tool.state.status !== "error") return false
  const { input, error } = tool.state
  if (typeof input.path !== "string" || !input.path) return false
  const absolute = path.resolve(root, "evidence", input.path)
  if ([root, `${root}/evidence`, `${root}/work`].includes(absolute)) return false
  // V2.2.1 reports ENOENT during search-root lookup as a tool error. This
  // expected discovery result is not an executor failure, wherever the agent
  // searched. The native executor already confines every search to Bubblewrap.
  return error.type === "tool.execution" && error.message === `Search path does not exist: ${input.path}`
}

export function unresolvedTools(tools: readonly AssistantTool[], root: string): AssistantTool[] {
  return tools.filter((tool, index) => {
    if (tool.state.status === "completed" || expectedSearchMiss(tool, root)) return false
    // Retain the failed event, but a successful retry of that exact invocation
    // resolves an execution error. Permission failures and unfinished calls do not.
    return !(tool.state.status === "error" && tool.state.error.type === "tool.execution" &&
      tools.slice(index + 1).some(next => next.name === tool.name && next.state.status === "completed" &&
        isDeepStrictEqual(next.state.input, tool.state.input)))
  })
}

export async function inventory(root: string, previous?: Readonly<Record<string, string>>, relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null)
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) Object.assign(result, await inventory(root, previous, name))
    // New build artifacts are already known additions. Hash only original
    // source paths, streaming replacements rather than buffering whole files.
    else if (entry.isFile() && previous && !Object.hasOwn(previous, name)) result[name] = "added"
    else if (entry.isFile()) {
      const hash = createHash("sha256")
      const file = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
      try { for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk) }
      finally { await file.close() }
      result[name] = hash.digest("hex")
    }
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
    const before: Record<string, string> = Object.create(null)
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
      const relative = path.relative(evidence, file)
      if (relative.startsWith("head/") || relative.startsWith("base/")) before[relative] = createHash("sha256").update(bytes).digest("hex")
    }
    if (request.files["source-executables.json"]) {
      const names = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(await readFile(target("source-executables.json"), "utf8")))
      for (const name of names) { if (!Object.hasOwn(request.files, name)) throw new Pause("Unsafe executable manifest"); await chmod(target(name), 0o755) }
    }
    if (request.completeness) await writeFile(target("completeness.json"), JSON.stringify(request.completeness, null, 2))
    for (const name of ["head", "base"]) if (Object.keys(request.files).some(f => f.startsWith(name + "/"))) await cp(target(name), path.join(work, name), { recursive: true })
    const root = `/curator-review-${randomUUID()}`
    const sandbox = { root, evidence, work, data, bun: path.dirname(path.dirname(process.execPath)),
      node: process.env.CURATOR_NODE_ROOT ?? path.join(homedir(), ".local/share/mise/installs/node/26.12.0"),
      toolchain: process.env.CURATOR_TOOLCHAIN ?? path.join(homedir(), ".local/share/omamail-curator/toolchain") }
    const item = JSON.parse(await readFile(target("input.json"), "utf8"))
    const criteria = ["base/AGENTS.md", ...(item.pr ? ["base/CONTRIBUTING.md"] : [])].filter(n => Object.hasOwn(request.files, n))
    const requiredEvidence = ["input.json", ...(item.changes ? ["changes.json"] : []), ...criteria]
    const result = await Effect.runPromise(Effect.scoped(review({ sandbox,
      database: process.env.CURATOR_DATABASE ?? path.join(homedir(), ".local/share/opencode/opencode.db"),
      guides: await guides(), system: SYSTEM, phase: request.phase, model: MODELS[request.phase],
      prompt: `Stage: ${request.phase}. Start at REVIEW.md, then follow its route. Required guides: ${requiredGuides(!!item.pr).join(", ")}; issues also require the final classification's type guide. Read REPORT.md before returning JSON.\nRequired native reads: ${requiredEvidence.join(", ")}. Open other evidence only as needed.\nEvidence root (default directory): ${root}/evidence. Persistent writable diagnostic copies: ${root}/work/head and ${root}/work/base; set shell workdir explicitly. Installed Rust, Node, Bun and offscreen/software Qt are available; no network or credentials. ${request.completeness ? "Prior completeness is context, not proof: completeness.json." : ""}`,
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
    const missingEvidence = requiredEvidence.filter(name => !inspected.has(name))
    if (missingEvidence.length) throw new Pause(`Required evidence was not inspected through native read: ${missingEvidence.join(", ")}`)
    const pages = new Set(tools.filter(t => t.name === "curator_guide" && t.state.status === "completed").map(t => (t.state as { input: Record<string, unknown> }).input.page))
    const missingGuides = requiredGuides(!!item.pr, output).filter(page => !pages.has(page))
    if (missingGuides.length) throw new Pause(`Required runtime guides were not read: ${missingGuides.join(", ")}`)
    const failed = unresolvedTools(tools, root)
    if (failed.length && ["continue", "ready"].includes(output.state)) throw new Pause(`Tool failure cannot yield a passing gate: ${failed.map(t => t.name).join(", ")}`)
    const after = await inventory(work, before)
    const modified = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort()
    return { ok: true, model: expected, session: result.session.id, assessment: output, tool_count: tools.length,
      verified_tools: true, runtime: "opencode-v2-workspace-bubblewrap", modified_scratch_paths: modified.slice(0, 200), modified_scratch_count: modified.length, events: messages }
  } finally {
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.off(signal, stop)
    await rm(job, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await guest(JSON.parse(await Bun.stdin.text())))) }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })); process.exitCode = 1 }
}
