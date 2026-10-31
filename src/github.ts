import { Pause, type Document } from "./policy.ts"
import { bounded } from "./io.ts"

export class GitHub {
  readonly prefix: string
  constructor(private token: string, readonly repository: string) { this.prefix = `/repos/${repository}` }
  async request(method: string, path: string, payload?: unknown): Promise<any> {
    if (!path.startsWith(this.prefix + "/") && !(method === "GET" && path === "/user")) throw new Pause("GitHub repository boundary violation")
    try {
      const response = await fetch("https://api.github.com" + path, { method, redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "omamail-curator", "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload) })
      if (!response.ok) { await response.body?.cancel(); throw new Pause(`GitHub HTTP ${response.status}: ${method} ${path}`) }
      const data = await bounded(response.body, 32 * 1024 * 1024)
      return data.length ? JSON.parse(data.toString()) : null
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
