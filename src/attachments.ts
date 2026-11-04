import { bounded } from "./io.ts"

const asset = /^\/user-attachments\/assets\/[0-9a-f-]{36}$/i
const mediaExtension = /\.(?:png|jpe?g|gif|mp4)(?:[?#]|$)/i
const redirects = new Set(["github.com", "raw.githubusercontent.com", "gist.githubusercontent.com", "release-assets.githubusercontent.com",
  "user-attachments.githubusercontent.com", "github-production-user-asset-6210df.s3.amazonaws.com"])

export function supportedMedia(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false
    if (u.hostname === "github.com") return asset.test(u.pathname) || /^\/[^/]+\/[^/]+\/(?:releases\/download|raw)\/.+/.test(u.pathname)
    if (u.hostname === "raw.githubusercontent.com") return /^\/[^/]+\/[^/]+\/[^/]+\/.+/.test(u.pathname)
    return u.hostname === "gist.githubusercontent.com" && /^\/[^/]+\/[a-f0-9]+\/raw(?:\/.*)?$/i.test(u.pathname)
  } catch { return false }
}

// Inventory unsupported image links too: absence from the collector is not
// evidence that the contributor supplied nothing. Never fetch arbitrary origins.
export function mediaLinks(texts: string[]) {
  const found = new Set<string>()
  for (const text of texts) {
    const images = new Set([...text.matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)|\bsrc=["']([^"']+)["']/gi)].map(m => m[1] ?? m[2]))
    for (const raw of text.match(/https?:\/\/[^\s<>"'\)\]]+/g) ?? []) {
      const url = raw.replace(/&amp;/g, "&").replace(/[.,;]+$/, "")
      if (images.has(raw) || mediaExtension.test(url) || supportedMedia(url)) found.add(url)
    }
  }
  return [...found].sort()
}

export async function downloadMedia(url: string) {
  if (!supportedMedia(url)) throw new Error("Unsupported media URL; not downloaded by curator")
  for (let count = 0; count < 6; count++) {
    const u = new URL(url)
    if (u.protocol !== "https:" || !redirects.has(u.hostname) || u.username || u.password || u.port) throw new Error("Media redirect origin rejected")
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const next = response.headers.get("location")
      if (!next) throw new Error("Media redirect missing")
      url = new URL(next, url).href
      continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Media HTTP ${response.status}`) }
    return bounded(response.body, 32 * 1024 * 1024)
  }
  throw new Error("Too many media redirects")
}
