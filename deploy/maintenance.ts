import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { checked } from "../src/io.ts"
import { readConfig } from "../src/policy.ts"

const timer = "omamail-curator.timer"

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: "string" } } })
  if (!values.config || !positionals.length) throw new Error("Usage: bun deploy/maintenance.ts --config CONFIG -- COMMAND [ARG...]")
  const config = readConfig(JSON.parse(await readFile(values.config, "utf8")))
  const command = Bun.which(positionals[0]), flock = Bun.which("flock")
  if (!command || !flock) throw new Error("Maintenance command and flock must be executable")
  const enabled = (await checked(["systemctl", "--user", "is-enabled", timer])).toString().trim()
  if (!["enabled", "enabled-runtime"].includes(enabled)) throw new Error("Enable the curator timer before maintenance")
  // Recover a prior manual stop, then leave scheduling active throughout.
  await checked(["systemctl", "--user", "start", timer])
  // Use the controller's existing lock; no independent service or cleanup hook.
  // Scheduled sweeps skip while the deployment holds it. The kernel releases it
  // when the command and any inheriting children exit, including after failure.
  const child = Bun.spawn([
    flock, path.join(config.state_dir, "sweep.lock"), command, ...positionals.slice(1),
  ], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  process.exitCode = await child.exited
  await checked(["systemctl", "--user", "is-active", timer])
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
