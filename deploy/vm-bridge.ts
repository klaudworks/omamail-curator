import { createConnection } from "node:net"
import { createInterface } from "node:readline"
import { open, readFile, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { checked, run, shellQuote } from "../src/io.ts"

const root = process.env.OMARCHY_VM_HOME ?? path.join(homedir(), "omamail-vm")

async function connect(options: { host: string, port: number } | { path: string }) {
  return new Promise<ReturnType<typeof createConnection>>((resolve, reject) => {
    const socket = createConnection(options)
    socket.setTimeout(3000, () => socket.destroy(new Error("Socket timed out")))
    socket.once("error", reject)
    socket.once("connect", () => resolve(socket))
  })
}
async function qmp(directory: string, command: string) {
  const socket = await connect({ path: path.join(directory, "qmp.sock") })
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]()
  try {
    if (!JSON.parse((await lines.next()).value ?? "{}").QMP) throw new Error("Invalid QMP greeting")
    for (const [id, execute] of [[1, "qmp_capabilities"], [2, command]]) {
      socket.write(JSON.stringify({ execute, arguments: {}, id }) + "\n")
      while (true) {
        const line = await lines.next()
        if (line.done) throw new Error("QMP closed")
        const message = JSON.parse(line.value)
        if (message.id !== id) continue
        if (message.error) throw new Error("QMP command failed")
        break
      }
    }
  } finally { socket.destroy() }
}
async function portReady() {
  try { const socket = await connect({ host: "127.0.0.1", port: 18931 }); socket.destroy(); return true } catch { return false }
}

async function main() {
  process.umask(0o077)
  if (!process.argv.includes("--locked")) {
    const child = Bun.spawn(["flock", "-n", path.join(root, "curator-bridge.lock"), process.execPath, import.meta.path, "--locked"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    process.exitCode = await child.exited; return
  }
  const request = JSON.parse(await Bun.stdin.text())
  const data = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"))
  const directory = await realpath(data.directory)
  if (path.dirname(directory) !== path.join(await realpath(root), "runs")) throw new Error("Invalid VM directory")
  const running = async () => {
    try {
      const pid = (await readFile(path.join(directory, "qemu.pid"), "utf8")).trim()
      if (!/^\d+$/.test(pid)) return false
      const args = (await readFile(`/proc/${pid}/cmdline`)).toString().split("\0")
      return path.basename(args[0]) === "qemu-system-x86_64" && args.join("\0").includes(path.join(directory, "qmp.sock"))
    } catch { return false }
  }
  if (!await running()) {
    const launch = JSON.parse(await readFile(path.join(directory, "launch.json"), "utf8"))
    await checked(launch.argv)
  }
  const ssh = ["ssh", "-F", "/dev/null", "-i", path.join(directory, "id_ed25519"), "-p", String(data.ssh_port),
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ForwardAgent=no", "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${path.join(directory, "known_hosts")}`, "-o", "ConnectTimeout=5", "-o", "LogLevel=ERROR"]
  const target = `${process.env.CURATOR_GUEST_USER ?? "omarchy"}@127.0.0.1`
  const guest = (command: string, input?: string) => run([...ssh, target, command], { input, timeout: 30_000 })
  const wait = async () => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      if (!await running()) throw new Error("QEMU exited")
      if ((await guest("true")).code === 0) return
      await Bun.sleep(3000)
    }
    throw new Error("VM SSH readiness timeout")
  }
  await wait()
  const now = await guest("date +%s")
  if (now.code || !Number.isFinite(Number(now.stdout.toString()))) throw new Error("Guest clock unavailable")
  if (Math.abs(Date.now() / 1000 - Number(now.stdout.toString())) > 90) {
    if ((await guest("sync")).code) throw new Error("Guest sync failed")
    await qmp(directory, "system_reset")
    await Bun.sleep(5000); await wait()
  }
  const network = path.join(directory, "auth-network")
  if (!await portReady()) {
    const log = await open(path.join(network, "proxy.log"), "a", 0o600)
    try { const proxy = Bun.spawn(["tinyproxy", "-d", "-c", path.join(network, "tinyproxy.conf")], { stdin: "ignore", stdout: log.fd, stderr: log.fd }); proxy.unref() }
    finally { await log.close() }
    const deadline = Date.now() + 15_000
    while (!await portReady()) { if (Date.now() > deadline) throw new Error("Model network proxy unavailable"); await Bun.sleep(200) }
  }
  const control = path.join(network, "ssh.sock")
  await run([...ssh, "-O", "exit", "-S", control, target], { timeout: 15_000 })
  await checked([...ssh, "-f", "-N", "-M", "-S", control, "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-R", "127.0.0.1:18931:127.0.0.1:18931", target], { timeout: 30_000 })
  request.host_time = Date.now() / 1000
  // The private guest environment supplies subscription/network configuration.
  // Only the trusted SDK process receives it; its sandbox spawner clears env.
  const entry = process.env.CURATOR_GUEST_ENTRY ?? "$HOME/.local/share/omamail-curator/src/guest.ts"
  const bun = process.env.CURATOR_GUEST_BUN ?? "$HOME/.local/opt/bun/1.4.3/bin/bun"
  const env = process.env.CURATOR_GUEST_ENV ?? "$HOME/.local/state/omamail-curator/model.env"
  const homePath = (value: string) => value.startsWith("$HOME/") ? `"$HOME"/${shellQuote(value.slice(6))}` : shellQuote(value)
  const command = `set -eu\nset -a\n. ${homePath(env)}\nset +a\nexec ${homePath(bun)} ${homePath(entry)}`
  const result = await run([...ssh, target, command], { input: JSON.stringify(request) })
  process.stderr.write(result.stderr); process.stdout.write(result.stdout); process.exitCode = result.code
}
if (import.meta.main) main().catch(error => { console.log(JSON.stringify({ ok: false, error: `VM bridge: ${error instanceof Error ? error.message : String(error)}` })); process.exitCode = 1 })
