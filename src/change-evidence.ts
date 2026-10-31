import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { checked, run } from "./io.ts"
import { Pause, type Config, type Document } from "./policy.ts"
import type { GitHub } from "./github.ts"

const sha = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Pause("Invalid change-evidence revision")
  return value
}

// Tree comparisons are local and complete. A merge title or an API diff against
// a merge base is not proof that a contributor made no additional changes.
export async function changeEvidence(api: GitHub, config: Config, before: Document, after: Document) {
  if (!before.head || !after.head) return { kind: "not-a-pr", review_required: false }
  const root = await mkdtemp(path.join(tmpdir(), "curator-changes-")), repo = path.join(root, "source.git")
  const env = { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" }
  const options = { env, timeout: 180_000, limit: 4 * 1024 * 1024 }
  const git = (...args: string[]) => checked(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", repo, ...args], options)
  const fetched = new Set<string>()
  const fetchSource = async (value: unknown) => {
    const revision = sha(value)
    if (!fetched.has(revision)) { await git("fetch", "--no-tags", "--depth=1", `https://github.com/${config.repository}.git`, revision); fetched.add(revision) }
    return revision
  }
  const diff = async (from: string, to: string) => {
    const args = ["diff", "--no-ext-diff", "--no-textconv"]
    return { from, to, paths: (await git(...args, "--name-only", "-z", from, to)).toString().split("\0").filter(Boolean), patch: (await git(...args, from, to)).toString() }
  }
  try {
    await checked(["git", "-c", "core.hooksPath=/dev/null", "init", "--bare", repo], options)
    const oldHead = await fetchSource(before.head), newHead = await fetchSource(after.head)
    const oldBase = await fetchSource(before.base), newBase = await fetchSource(after.base)
    const changes = await diff(oldHead, newHead), baseChanges = await diff(oldBase, newBase)
    const comparison = await api.get(`/compare/${newBase}...${newHead}`)
    if (comparison.base_commit?.sha !== newBase) throw new Pause("Unexpected relevance comparison base")
    const mergeBase = await fetchSource(comparison.merge_base_commit?.sha)
    const contribution = await diff(mergeBase, newHead)
    let cleanMerge = false
    if (newHead !== oldHead) {
      const commit = await api.get(`/commits/${newHead}`)
      if (commit.sha !== newHead) throw new Pause("Unexpected merge commit")
      const parents = commit.parents ?? []
      if (parents.length === 2 && parents[0].sha === oldHead) {
        const incoming = sha(parents[1].sha)
        const upstream = await api.get(`/compare/${incoming}...${newBase}`)
        if (upstream.base_commit?.sha !== incoming) throw new Pause("Unexpected upstream comparison")
        // The other parent must actually be in the target branch's ancestry.
        if (upstream.merge_base_commit?.sha === incoming && ["ahead", "identical"].includes(upstream.status)) {
          await fetchSource(incoming)
          const merge = await api.get(`/compare/${oldHead}...${incoming}`)
          if (merge.base_commit?.sha !== oldHead) throw new Pause("Unexpected merge-parent comparison")
          const ancestor = await fetchSource(merge.merge_base_commit?.sha)
          const result = await run(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", repo, "merge-tree", "--write-tree", `--merge-base=${ancestor}`, "--no-messages", oldHead, incoming], options)
          cleanMerge = result.code === 0 && result.stdout.toString().trim() === sha(commit.commit?.tree?.sha)
        }
      }
    }
    const binary = [changes, baseChanges, contribution].some(d => /^Binary files /m.test(d.patch))
    const documentationOnly = changes.paths.every(p => /\.(md|rst|txt)$/.test(p) && !/(?:^|\/)(?:AGENTS|CONTRIBUTING)\.md$/.test(p))
    return { kind: cleanMerge ? "verified-branch-sync" : changes.paths.length ? "changed-tree" : "identical-head-tree",
      clean_merge_verified: cleanMerge, review_required: binary || changes.paths.length > 0 && !cleanMerge && !documentationOnly,
      reason: binary ? "Binary changes require inspection" : undefined,
      changes, target_branch_changes: baseChanges, current_contribution: contribution, complete: true }
  } catch (error) {
    // Incomplete source evidence can never be used to suppress a review.
    return { kind: "unavailable", review_required: true, complete: false, reason: String(error).slice(0, 300) }
  } finally { await rm(root, { recursive: true, force: true }) }
}
