import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { WorkspaceDriver } from "@opencode/sdk/effect"
import { existsSync } from "node:fs"

export interface Sandbox {
  root: string
  evidence: string
  work: string
  data: string
  bun: string
  node: string
  toolchain: string
}

export const makeDriver = Effect.fn(function* (spec: Sandbox) {
  const host = yield* ChildProcessSpawner.pipe(
    Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
  )
  const wrap = (cmd: ChildProcess.Command): ChildProcess.Command => {
    if (cmd._tag === "PipedCommand")
      return ChildProcess.pipeTo(wrap(cmd.left), wrap(cmd.right), cmd.options)
    const args = sandboxArgs(spec, cmd)
    return ChildProcess.make("/usr/bin/bwrap", args, {
      ...cmd.options, cwd: "/", env: {}, extendEnv: false, shell: false,
      additionalFds: undefined, detached: true,
    })
  }
  const spawner = ChildProcessSpawner.of({ ...host, spawn: cmd => host.spawn(wrap(cmd)) })
  const driver = WorkspaceDriver.make({
    create: () => Effect.succeed({ binding: { root: spec.root } }),
    connect: ({ binding }) => binding.root === spec.root ? Effect.succeed({ spawner }) :
      Effect.fail(new WorkspaceDriver.Error({ message: "Workspace belongs to another review stage" })),
    suspendForIdle: () => Effect.void,
    destroy: () => Effect.void,
  })
  return { driver, spawner }
})

function sandboxArgs(spec: Sandbox, cmd: ChildProcess.StandardCommand) {
  const args = ["--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--disable-userns", "--cap-drop", "ALL",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib", "/lib64", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--tmpfs", "/home", "--dir", "/home/reviewer", "--dir", "/etc",
    "--ro-bind", spec.evidence, `${spec.root}/evidence`, "--bind", spec.work, `${spec.root}/work`,
    "--ro-bind", spec.bun, "/opt/curator-bun", "--ro-bind", spec.node, "/opt/curator-node",
    "--ro-bind", spec.toolchain, "/opt/curator-toolchain", "--clearenv",
    "--setenv", "PATH", "/opt/curator-bun/bin:/opt/curator-node/bin:/opt/curator-toolchain/bin:/usr/lib/qt6/bin:/usr/bin:/bin",
    "--setenv", "HOME", "/home/reviewer", "--setenv", "LANG", "C.UTF-8",
    "--setenv", "QT_QPA_PLATFORM", "offscreen", "--setenv", "QT_QUICK_BACKEND", "software"]
  for (const name of ["/etc/fonts", "/etc/ssl/certs", "/etc/ld.so.cache"])
    if (existsSync(name)) args.push("--ro-bind", name, name)
  if (existsSync(`${spec.toolchain}/cargo-registry`)) args.push("--dir", "/home/reviewer/.cargo",
    "--ro-bind", `${spec.toolchain}/cargo-registry`, "/home/reviewer/.cargo/registry",
    "--setenv", "CARGO_HOME", "/home/reviewer/.cargo", "--setenv", "CARGO_NET_OFFLINE", "true")
  for (const name of ["shell", "tool-output"]) args.push("--ro-bind", `${spec.data}/${name}`, `${spec.data}/${name}`)
  for (const [key, value] of Object.entries(cmd.options.env ?? {}))
    if (["LC_ALL", "TERM", "OPENCODE_TERMINAL"].includes(key) && typeof value === "string") args.push("--setenv", key, value)
  return [...args, "--chdir", cmd.options.cwd ?? `${spec.root}/evidence`, "--", cmd.command, ...cmd.args]
}
