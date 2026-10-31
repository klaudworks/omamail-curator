import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Pause, type Config, type Document } from "./policy.ts"
import { checked, bounded } from "./io.ts"
import { Checkpoints } from "./state.ts"
import type { GitHub } from "./github.ts"
import type { Snapshot } from "./snapshot.ts"
import type { ChangeContext } from "./changes.ts"

const env = { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" }
const command = (args: string[], input?: string) => checked(args, { env, input, timeout: 180_000 })
const validSHA = (sha: string) => { if (!/^[0-9a-f]{40}$/.test(sha)) throw new Pause("Invalid source revision"); return sha }

async function attachment(url: string) {
  const origins = new Set(["github.com", "user-attachments.githubusercontent.com", "github-production-user-asset-6210df.s3.amazonaws.com"])
  for (let count = 0; count < 6; count++) {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" || !origins.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error("Attachment redirect origin rejected")
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const next = response.headers.get("location")
      if (!next) throw new Error("Attachment redirect missing")
      url = new URL(next, url).href; continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Attachment HTTP ${response.status}`) }
    return bounded(response.body, 32 * 1024 * 1024)
  }
  throw new Error("Too many attachment redirects")
}

export async function collect(snap: Snapshot, config: Config, directory: string, checkpoints: Checkpoints, api: GitHub, changes?: ChangeContext) {
  const repo = path.join(directory, "source.git"), pr = snap.pr
  await command(["git", "-c", "core.hooksPath=/dev/null", "init", "--bare", repo])
  let revisions = pr ? { head: validSHA(pr.head.sha), base: validSHA(pr.base.sha) } : { head: "HEAD", base: "HEAD" }
  let comparisonBase = revisions.base
  if (pr) {
    const comparison = await api.get(`/compare/${revisions.base}...${revisions.head}`)
    if (comparison.base_commit?.sha !== revisions.base) throw new Pause("Unexpected PR comparison base")
    comparisonBase = validSHA(comparison.merge_base_commit?.sha)
  }
  const fetchSource = (sha: string) => command(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", repo, "fetch", "--depth=1", `https://github.com/${config.repository}.git`, sha])
  for (const sha of new Set([...Object.values(revisions), comparisonBase])) await fetchSource(sha)
  if (!pr) { const sha = validSHA((await command(["git", "--git-dir", repo, "rev-parse", "FETCH_HEAD"])).toString().trim()); revisions = { head: sha, base: sha }; comparisonBase = sha }
  const files: Record<string, string> = {}, omitted: string[] = [], executables: string[] = []
  for (const [name, sha] of Object.entries(revisions)) {
    // Enumerate tree records without checking out, extracting archives or following
    // links. cat-file reads raw blobs, never filters, hooks or contributor code.
    const records = (await command(["git", "--git-dir", repo, "ls-tree", "-rlz", sha])).toString().split("\0").filter(Boolean)
    const blobs: { name: string, id: string, size: number, executable: boolean }[] = []
    for (const record of records) {
      const tab = record.indexOf("\t"), filename = record.slice(tab + 1)
      const [mode, type, id, size] = record.slice(0, tab).trim().split(/\s+/)
      if (type !== "blob" || !["100644", "100755"].includes(mode)) { omitted.push(`${name}/${filename} (link/special file)`); continue }
      if (Number(size) > 4 * 1024 * 1024) { omitted.push(`${name}/${filename}`); continue }
      blobs.push({ name: `${name}/${filename}`, id, size: Number(size), executable: mode === "100755" })
    }
    const raw = await command(["git", "--git-dir", repo, "cat-file", "--batch"], blobs.map(b => b.id).join("\n") + "\n")
    let offset = 0
    for (const blob of blobs) {
      const end = raw.indexOf(10, offset)
      if (end < 0 || raw.subarray(offset, end).toString() !== `${blob.id} blob ${blob.size}` || end + 1 + blob.size >= raw.length) throw new Pause("Invalid source blob stream")
      files[blob.name] = raw.subarray(end + 1, end + 1 + blob.size).toString("base64")
      offset = end + blob.size + 2
      if (blob.executable) executables.push(blob.name)
    }
    if (offset !== raw.length) throw new Pause("Unexpected source blob data")
  }
  const diffArgs = ["git", "--git-dir", repo, "diff", "--no-ext-diff", "--no-textconv"]
  // GitHub PRs compare head against its merge base, not today's target tip.
  // Keep base/ at the target revision for accepted repository guidance.
  const diff = await command([...diffArgs, comparisonBase, revisions.head])
  if (diff.length > 4 * 1024 * 1024) throw new Pause("Diff exceeds bounded evidence ingestion")
  files["diff.patch"] = diff.toString("base64")
  const paths = (await command(["git", "--git-dir", repo, "diff", "--name-only", "-z", comparisonBase, revisions.head])).toString().split("\0").filter(Boolean)
  snap.criteria_changed = paths.some(p => p.endsWith("AGENTS.md") || p.endsWith("CONTRIBUTING.md") || p.startsWith(".opencode/"))
  const events = snap.events.filter(e => !checkpoints.decode(e, snap.item.number))
  const context: Document = { item: Object.fromEntries(["number", "title", "body", "html_url", "user"].map(k => [k, snap.item[k] ?? null])),
    eligibility: { repository: config.repository, opener_verified: true, state: "open", draft: pr ? false : null, ci_gate: pr ? "passed" : "not applicable to issues" },
    revisions, comparison: { base: comparisonBase, head: revisions.head, path: "diff.patch" }, pr: !!pr, ci: snap.ci, discussion: events, previous: snap.previous, changed_files: paths, criteria_changed: snap.criteria_changed,
    omitted_source: omitted, assets: [], maintainers: config.maintainers }
  if (changes) {
    files["changes.json"] = Buffer.from(JSON.stringify(changes, null, 2)).toString("base64")
    context.changes = { path: "changes.json", meaning: "The same assessed baseline, accumulated changes and workflow state used by the controller's relevance gate. Start here for incremental work; verify against current evidence." }
  }
  if (!pr) {
    const release: Document = { current_source: revisions.head }
    try {
      const version = Buffer.from(files["base/backend-version"] ?? "", "base64").toString().trim()
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("No supported pinned release version")
      const tag = `v${version}`, published = await api.get(`/releases/tags/${tag}`)
      if (published.draft || published.tag_name !== tag || !published.published_at) throw new Error("Pinned release is not published")
      const commit = await api.get(`/commits/${tag}`), sha = validSHA(commit.sha)
      await fetchSource(sha)
      const changed = (await command([...diffArgs, "--name-only", "-z", sha, revisions.head])).toString().split("\0").filter(Boolean)
      const releaseDiff = await command([...diffArgs, sha, revisions.head])
      Object.assign(release, { version, tag, url: published.html_url, published_at: published.published_at, prerelease: published.prerelease,
        source: sha, changed_paths: changed, changed_paths_complete: true,
        meaning: "Paths absent from changed_paths have identical Git content at the pinned release and current source. This is source inclusion, not live-provider verification." })
      if (releaseDiff.length <= 4 * 1024 * 1024) { files["release.patch"] = releaseDiff.toString("base64"); release.patch = "release.patch" }
      else release.patch_unavailable = "Release diff exceeds bounded ingestion limit; changed_paths remains complete."
    } catch (error) { release.unavailable = String(error).slice(0, 300) }
    files["release.json"] = Buffer.from(JSON.stringify(release, null, 2)).toString("base64")
    context.release = { path: "release.json" }

    const texts = [...events].reverse().map(e => e.body ?? "").concat(snap.item.body ?? "")
    const repositoryPattern = config.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const referencePattern = new RegExp(`(?:https://github\\.com/${repositoryPattern}/(?:issues|pull)/|(?<![\\w/])#)([1-9]\\d*)\\b`, "g")
    const references = [...new Set(texts.flatMap(text => [...String(text).matchAll(referencePattern)].map(match => Number(match[1]))))].filter(n => n !== snap.item.number)
    const related: Document = { items: [], omitted_numbers: references.slice(8), collected_at: new Date().toISOString() }
    for (const number of references.slice(0, 8)) {
      try {
        const item = await api.get(`/issues/${number}`)
        const comments = (await api.pages(`/issues/${number}/comments`)).filter(c => !checkpoints.decode(c, number))
        const entry: Document = { number, title: item.title, body: item.body, url: item.html_url, state: item.state, author: item.user?.login,
          comments: comments.map(c => ({ id: c.id, user: c.user, body: c.body, updated_at: c.updated_at, url: c.html_url })) }
        if (item.pull_request) {
          const linked = await api.get(`/pulls/${number}`)
          entry.pr = { draft: linked.draft, merged: linked.merged, merged_at: linked.merged_at, merge_commit_sha: linked.merge_commit_sha, head: linked.head?.sha }
        }
        related.items.push(entry)
      } catch (error) { related.items.push({ number, unavailable: String(error).slice(0, 300) }) }
    }
    files["related.json"] = Buffer.from(JSON.stringify(related, null, 2)).toString("base64")
    context.related = { path: "related.json", count: related.items.length, omitted: related.omitted_numbers.length }
  }
  const previousHead = snap.previous?.head
  if (pr && previousHead && previousHead !== revisions.head) {
    try {
      await fetchSource(validSHA(previousHead))
      const delta = await command([...diffArgs, previousHead, revisions.head])
      if (delta.length > 4 * 1024 * 1024) throw new Pause("Delta exceeds bounded evidence ingestion")
      files["delta.patch"] = delta.toString("base64")
      context.delta = { from: previousHead, to: revisions.head, path: "delta.patch", equivalent_tree: !delta.length }
    } catch (error) { context.delta = { unavailable: String(error), requirement: "Reassess from the full diff; do not assume unchanged evidence." } }
  }
  const urls = [...new Set(JSON.stringify(context).match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}/g) ?? [])].sort()
  for (const [index, url] of urls.entries()) {
    const asset: Document = { url }
    try {
      const data = await attachment(url)
      const ext = data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? ".png" : data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) ? ".jpg" : data.subarray(4, 8).toString() === "ftyp" ? ".mp4" : undefined
      if (!ext) throw new Error("Unsupported attachment type")
      if (ext !== ".mp4") { const name = `assets/${index}${ext}`; files[name] = data.toString("base64"); asset.path = name }
      else {
        const video = path.join(directory, `video-${index}.mp4`), frames = path.join(directory, `frames-${index}`)
        await writeFile(video, data); await mkdir(frames)
        await checked(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", video, "-vf", "fps=1/4,scale=1280:-2", "-frames:v", "8", path.join(frames, "%02d.png")], { env: { PATH: process.env.PATH }, timeout: 60_000 })
        asset.sampled_frames = []
        for (const frame of (await readdir(frames)).filter(f => f.endsWith(".png")).sort()) {
          const name = `assets/${index}-frame-${frame}`; files[name] = (await readFile(path.join(frames, frame))).toString("base64"); asset.sampled_frames.push(name)
        }
        asset.limitations = "Sampled frames every four seconds, at most eight; not full playback or verification of motion/audio."
      }
    } catch (error) { asset.unavailable = String(error).slice(0, 200) }
    context.assets.push(asset)
  }
  for (const key of ["discussion", "ci", "previous", "assets"]) {
    const value = context[key]
    if (value === null) continue
    const name = key + ".json"
    files[name] = Buffer.from(JSON.stringify(value, null, 2)).toString("base64")
    context[key] = { path: name }
    if (key === "discussion" || key === "assets") context[key].count = value.length
    else if (key === "ci") Object.assign(context[key], { status: pr ? "success" : "not applicable", workflows: value.length, jobs: value.reduce((n: number, r: Document) => n + r.jobs.length, 0) })
    else Object.assign(context[key], { head: value.head, state: value.assessment.state, blockers: value.assessment.blockers })
  }
  files["input.json"] = Buffer.from(JSON.stringify(context, null, 2)).toString("base64")
  files["source-executables.json"] = Buffer.from(JSON.stringify(executables)).toString("base64")
  if (Object.values(files).reduce((n, v) => n + v.length, 0) > 128 * 1024 * 1024) throw new Pause("Evidence package exceeds bounded ingestion limit")
  return files
}
