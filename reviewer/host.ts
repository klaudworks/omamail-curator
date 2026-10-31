import { existsSync } from "node:fs"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { Agent, AbsolutePath, Location, Model, OpenCode, Provider } from "@opencode/sdk/effect"
import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Config } from "@opencode/core/config"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Global } from "@opencode/util/global"
import { makeDriver, type Sandbox } from "./workspace.ts"

export interface Request {
  sandbox: Sandbox
  database: string
  guides: Record<string, string>
  system: string
  prompt: string
  phase: string
  model: string
}

const allowed = new Set(["read", "glob", "grep", "shell", "patch", "edit", "write", "curator_guide"])

export const createHost = Effect.fn(function* (request: Request) {
  const spec = request.sandbox
  // Native read's auxiliary host helpers cannot see files under this virtual
  // prefix. Never create it on the host, nor mount an actual host working path.
  if (existsSync(spec.root)) throw new Error("Sandbox virtual root exists on host")
  const { driver, spawner } = yield* makeDriver(spec)
  const directory = `${spec.root}/evidence`
  const safeRead = (value: string) => {
    const absolute = path.resolve(directory, value)
    return absolute === spec.root || absolute.startsWith(spec.root + "/") ||
      ["shell", "tool-output"].some(name => absolute.startsWith(`${spec.data}/${name}/`))
  }
  const policy = Plugin.define({
    id: "curator.policy",
    effect: ctx => Effect.gen(function* () {
      yield* ctx.tool.transform(editor => {
        for (const tool of editor.list()) if (!allowed.has(tool.id)) editor.remove(tool.id)
        editor.add({
          name: "curator_guide", description: "Read trusted installed review guidance. Start at REVIEW.md.",
          input: Schema.Struct({ page: Schema.Literals(Object.keys(request.guides)) }),
          options: { codemode: false },
          execute: ({ page }) => Effect.succeed({ content: request.guides[page] }),
        })
      })
      yield* ctx.tool.hook("execute.before", event => {
        if (!allowed.has(event.tool)) return Effect.fail(new Tool.Error({ message: "Unavailable reviewer tool" }))
        // The primary read is sandboxed. V2.2.1's fallback suggestions and
        // nested AGENTS discovery still use host FSUtil; contain those too.
        if (event.tool === "read") {
          const input = event.input as { path?: unknown }
          if (typeof input.path !== "string" || input.path.startsWith("~") || !safeRead(input.path))
            return Effect.fail(new Tool.Error({ message: "Read paths must be within this review workspace or its output files" }))
        }
        return Effect.void
      })
      yield* ctx.shell.hook("create.before", event => Effect.sync(() => {
        event.shell = "/bin/bash"
        event.env = {}
      }))
      yield* ctx.session.hook("context", event => Effect.sync(() => {
        for (const name of Object.keys(event.tools)) if (!allowed.has(name)) delete event.tools[name]
        for (const name of ["read", "glob", "grep", "shell", "patch", "curator_guide"])
          if (!event.tools[name]) throw new Error(`Required native tool unavailable: ${name}`)
      }))
      yield* ctx.session.hook("title", event => Effect.sync(() => { event.result = `Curator ${request.phase}` }))
    }),
  })
  const permissions = [{ action: "*", resource: "*", effect: "deny" },
    ...[...allowed, "external_directory"].map(action => ({ action, resource: "*", effect: "allow" }))]
  const config = JSON.stringify({
    $schema: "https://opencode.ai/config.json", default_agent: "curator", snapshots: false,
    formatter: false, lsp: false, shell: "/bin/bash",
    agents: { curator: { mode: "primary", system: request.system, permissions } },
    policies: [{ action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "openai", effect: "allow" }],
  })
  const host = yield* OpenCode.create({
    plugins: [policy], workspaceProviders: { bubblewrap: driver },
    database: { path: request.database },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
    log: { level: "warn", emit: entry => console.error(JSON.stringify(entry)) },
  }, { overrides: [
    Config.node.replace(Config.configured({ project: false, global: false, system: false, claude: false, content: config })),
    InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
    // This process owns exactly one fresh stage, not other claims in the auth
    // database. The controller, not SDK startup recovery, decides what runs.
    SessionRestart.node.replace(Layer.succeed(SessionRestart.Service, { resumeSuspendedSessions: Effect.void })),
    Global.node.replace(Global.layerWith({ data: spec.data })),
  ] })
  const workspaceID = yield* host.workspace.create({ provider: "bubblewrap" })
  yield* host.workspace.provision({ workspaceID })
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID })
  return { host, location, spawner }
})

export const review = Effect.fn(function* (request: Request) {
  const { host, location } = yield* createHost(request)
  const [provider, selection] = request.model.split("/")
  const [model, variant] = selection.split("#")
  const session = yield* host.sessions.create({ location, title: `Curator ${request.phase}`,
    agent: Agent.ID.make("curator"),
    model: { providerID: Provider.ID.make(provider), id: Model.ID.make(model), variant: Model.VariantID.make(variant) },
  })
  console.error("curator session", session.id)
  yield* host.sessions.prompt({ sessionID: session.id, text: request.prompt })
  yield* host.sessions.wait({ sessionID: session.id })
  const messages = yield* host.sessions.export({ sessionID: session.id })
  return { session, messages }
})
