import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import fsPath from "node:path"
import { Pause, digest, type Document } from "./policy.ts"
import { bounded } from "./io.ts"

interface RateLimit { limit: number | null; remaining: number | null; reset: number | null; until: number; failures: number; reason: string }
interface Cached { path: string; etag: string; data: unknown }
const integer = (value: string | null) => value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
const validEtag = (value: unknown): value is string => typeof value === "string" && /^(W\/)?"[^"\r\n]{1,1000}"$/.test(value)

export class GitHubBackoff extends Pause {
  constructor(readonly until: number, reason: string) { super(`GitHub ${reason}; retry after ${new Date(until).toISOString()}`) }
}

export class GitHub {
  readonly prefix: string
  private directory?: string
  private loaded = false
  private rate: RateLimit = { limit: null, remaining: null, reset: null, until: 0, failures: 0, reason: "" }
  readonly usage = { requests: 0, not_modified: 0 }
  constructor(private token: string, readonly repository: string, stateDirectory?: string) {
    this.prefix = `/repos/${repository}`
    // Separate credentials and repositories never share response bodies or validators.
    if (stateDirectory) this.directory = fsPath.join(stateDirectory, "github", digest({ repository, token }))
  }
  get rateLimit() {
    return { limit: this.rate.limit, remaining: this.rate.remaining, reset_at: this.rate.reset === null ? null : new Date(this.rate.reset * 1000).toISOString(),
      retry_at: this.rate.until ? new Date(this.rate.until).toISOString() : null }
  }
  private async read(name: string, optionalCache = false): Promise<any> {
    if (!this.directory) return null
    try { return JSON.parse(await readFile(fsPath.join(this.directory, name + ".json"), "utf8")) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || optionalCache && error instanceof SyntaxError) return null
      throw new Pause("Unreadable GitHub cache/backoff state")
    }
  }
  private async write(name: string, value: unknown) {
    if (!this.directory) return
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const file = fsPath.join(this.directory, name + ".json"), temp = file + "." + randomBytes(4).toString("hex")
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, file) }
    finally { await rm(temp, { force: true }) }
  }
  private async available() {
    if (!this.loaded) {
      const saved = await this.read("rate-limit")
      if (saved !== null) {
        if (!saved || !["limit", "remaining", "reset"].every(k => saved[k] === null || Number.isSafeInteger(saved[k]) && saved[k] >= 0) ||
          !Number.isSafeInteger(saved.until) || saved.until < 0 || saved.until > 8.64e15 || saved.reset !== null && saved.reset > 8.64e12 ||
          !Number.isSafeInteger(saved.failures) || saved.failures < 0 || typeof saved.reason !== "string") throw new Pause("Invalid GitHub backoff state")
        this.rate = saved
      }
      this.loaded = true
    }
    if (this.rate.until > Date.now()) throw new GitHubBackoff(this.rate.until, this.rate.reason)
  }
  private async responseRate(response: Response, message: string) {
    const now = Date.now(), headers = response.headers
    const limit = integer(headers.get("x-ratelimit-limit")), remaining = integer(headers.get("x-ratelimit-remaining")), reset = integer(headers.get("x-ratelimit-reset"))
    const retry = headers.get("retry-after")
    const retryAt = retry === null ? NaN : /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)
    const limited = response.status === 429 || response.status === 403 && (remaining === 0 || retry !== null || /rate limit|abuse detection/i.test(message))
    const failures = limited ? this.rate.failures + 1 : 0
    let until = 0, reason = ""
    if (remaining === 0 && (response.ok || response.status === 304 || limited)) {
      until = reset !== null && reset * 1000 > now && reset <= 8.64e12 ? reset * 1000 + 1000 : now + 60_000
      reason = "primary rate limit exhausted"
    }
    if (limited) {
      const fallback = now + Math.min(3_600_000, 60_000 * 2 ** Math.min(failures - 1, 6))
      until = Math.max(until, Number.isFinite(retryAt) && retryAt > now && retryAt < 8.64e15 ? retryAt + 1000 : until || fallback)
      reason ||= "secondary rate limit"
    }
    this.rate = { limit: limit ?? this.rate.limit, remaining: remaining ?? this.rate.remaining, reset: reset !== null && reset <= 8.64e12 ? reset : this.rate.reset, until, failures, reason }
    await this.write("rate-limit", this.rate)
    if (limited) throw new GitHubBackoff(until, reason)
  }
  async request(method: string, path: string, payload?: unknown): Promise<any> {
    if (!path.startsWith(this.prefix + "/") && !(method === "GET" && path === "/user")) throw new Pause("GitHub repository boundary violation")
    await this.available()
    const cacheKey = "response-" + digest(path)
    const saved = method === "GET" ? await this.read(cacheKey, true) : null
    const cached: Cached | null = saved?.path === path && validEtag(saved.etag) && Object.hasOwn(saved, "data") ? saved : null
    try {
      this.usage.requests++
      const response = await fetch("https://api.github.com" + path, { method, redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "omamail-curator", "Content-Type": "application/json",
          ...(cached ? { "If-None-Match": cached.etag } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload) })
      if (!response.ok && response.status !== 304) {
        // Error bodies are used only to classify throttling, never logged or cached.
        const detail = (await bounded(response.body, 1024 * 1024)).toString()
        await this.responseRate(response, detail)
        throw new Pause(`GitHub HTTP ${response.status}: ${method} ${path}`)
      }
      await this.responseRate(response, "")
      if (response.status === 304) {
        await response.body?.cancel()
        if (!cached) throw new Pause("GitHub returned 304 without a cached response")
        this.usage.not_modified++
        return cached.data
      }
      const bytes = await bounded(response.body, 32 * 1024 * 1024)
      const data = bytes.length ? JSON.parse(bytes.toString()) : null
      if (method === "GET" && this.directory) {
        const etag = response.headers.get("etag")
        if (validEtag(etag)) await this.write(cacheKey, { path, etag, data })
        else await rm(fsPath.join(this.directory, cacheKey + ".json"), { force: true })
      }
      return data
    } catch (error) {
      if (error instanceof Pause) throw error
      throw new Pause("GitHub transport/JSON failure")
    }
  }
  get(path: string) { return this.request("GET", this.prefix + path) }
  mutate(method: string, path: string, payload?: unknown) { return this.request(method, this.prefix + path, payload) }
  async pages(path: string, key?: string): Promise<Document[]> {
    const values: Document[] = []
    for (let page = 1; ; page++) {
      const result = await this.get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)
      const batch = key ? result[key] : result
      if (!Array.isArray(batch)) throw new Pause("Invalid paginated response")
      values.push(...batch)
      if (batch.length < 100) {
        if (key && result.total_count !== undefined && values.length < result.total_count) throw new Pause("Incomplete GitHub pagination")
        return values
      }
    }
  }
}
