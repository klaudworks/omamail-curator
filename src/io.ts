import { Pause } from "./policy.ts"

export async function bounded(stream: ReadableStream<Uint8Array> | null, limit = 192 * 1024 * 1024) {
  if (!stream) return Buffer.alloc(0)
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks)
      size += value.length
      if (size > limit) throw new Pause("Output exceeds bounded ingestion limit")
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
}

export async function run(argv: string[], options: { cwd?: string, env?: Record<string, string | undefined>, input?: string | Uint8Array, timeout?: number, limit?: number } = {}) {
  const child = Bun.spawn(argv, { cwd: options.cwd, env: options.env, stdin: options.input === undefined ? "ignore" : new Blob([typeof options.input === "string" ? options.input : new Uint8Array(options.input)]), stdout: "pipe", stderr: "pipe" })
  const timer = options.timeout ? setTimeout(() => child.kill("SIGKILL"), options.timeout) : undefined
  try {
    const [stdout, stderr, code] = await Promise.all([bounded(child.stdout, options.limit), bounded(child.stderr, 4 * 1024 * 1024), child.exited])
    return { stdout, stderr, code }
  } catch (error) { child.kill("SIGKILL"); await child.exited; throw error }
  finally { clearTimeout(timer) }
}

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export async function checked(argv: string[], options: Parameters<typeof run>[1] = {}) {
  const result = await run(argv, options)
  if (result.code) throw new Pause(`Command failed (${argv[0]}): ${result.stderr.toString().slice(0, 500)}`)
  return result.stdout
}
