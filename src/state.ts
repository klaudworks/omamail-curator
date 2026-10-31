import { createHmac, timingSafeEqual } from "node:crypto"
import { canonical, digest, type Document } from "./policy.ts"

export class Checkpoints {
  constructor(private key: Buffer, readonly repository: string, readonly login: string) {}
  private sign(raw: string) { return createHmac("sha256", this.key).update(raw).digest("hex") }
  encode(payload: unknown) {
    const raw = Buffer.from(canonical(payload)).toString("base64url")
    return `<!-- omamail-curator:v1:${raw}:${this.sign(raw)} -->`
  }
  decode(event: Document, number: number, kind?: string): Document | null {
    if (event.user?.login?.toLowerCase() !== this.login) return null
    const matches = [...(event.body ?? "").matchAll(/<!-- omamail-curator:v1:([A-Za-z0-9_-]+):([0-9a-f]{64}) -->/g)]
    if (matches.length !== 1) return null
    const [, raw, sig] = matches[0]
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(this.sign(raw)))) return null
    let data: Document
    try { data = JSON.parse(Buffer.from(raw, "base64url").toString()) } catch { return null }
    if (!data || data.repository !== this.repository || data.number !== number || kind && data.type !== kind) return null
    const visible = (event.body ?? "").split("\n\n<!-- omamail-curator:v1:")[0]
    return data.report_hash === digest(visible) ? data : null
  }
  current(comments: Document[], number: number): [Document | null, Document | null] {
    const found = comments.map(c => [c, this.decode(c, number, "status")] as const).filter(([, data]) => data).sort(([a], [b]) => b.id - a.id)
    return found.length ? [...found[0]] : [null, null]
  }
  fingerprint(item: Document, pr: Document | null, events: Document[]) {
    const relevant = events.filter(e => !this.decode(e, item.number) && e.user?.type !== "Bot")
      .map(e => Object.fromEntries(["id", "body", "updated_at", "state", "commit_id", "user"].map(k => [k, e[k] ?? null])))
    return digest({ id: item.node_id, title: item.title, body: item.body ?? null, head: pr?.head.sha ?? null, base: pr?.base.sha ?? null, events: relevant })
  }
}
