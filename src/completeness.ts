import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { assessment, contractVersion, MODELS, type Assessment, type Config } from "./policy.ts"
import type { Provenance } from "./publisher.ts"
import type { Snapshot } from "./snapshot.ts"

// Private controller state, never contributor evidence. Preserve a verified pass
// before final review. Ordinary updates retain it; stage-aware routing can clear
// it when changed prerequisites need another entry check.
export class Completeness {
  constructor(private config: Config) {}
  private file(snap: Snapshot) { return path.join(this.config.state_dir, "completeness", `${snap.item.number}.json`) }
  async invalidate(snap: Snapshot) { await rm(this.file(snap), { force: true }) }
  async save(snap: Snapshot, result: Assessment, provenance: Provenance) {
    if (!snap.pr || assessment(result, "completeness").state !== "continue" || provenance.model !== MODELS.completeness || provenance.verified_tools !== true || !provenance.session.startsWith("ses_")) throw new Error("Only verified passing PR completeness can be retained")
    const file = this.file(snap)
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(`${file}.tmp`, JSON.stringify({ version: 2, repository: this.config.repository, number: snap.item.number,
      contract_version: contractVersion(true), head: snap.pr.head.sha, result, provenance }), { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }
  async load(snap: Snapshot): Promise<{ result: Assessment, provenance: Provenance } | null> {
    if (!snap.pr) return null
    let raw: string
    try { raw = await readFile(this.file(snap), "utf8") }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
    try {
      const saved = JSON.parse(raw)
      // Version 1 also records a verified pass; retain that milestone on upgrade.
      if (![1, 2].includes(saved.version) || saved.repository !== this.config.repository || saved.number !== snap.item.number ||
        saved.contract_version !== contractVersion(true)) return null
      const result = assessment(saved.result, "completeness"), provenance = saved.provenance
      if (result.state !== "continue" || provenance?.model !== MODELS.completeness || provenance.verified_tools !== true || !provenance.session?.startsWith("ses_")) return null
      return { result, provenance }
    } catch { return null }
  }
}
