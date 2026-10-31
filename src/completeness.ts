import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { assessment, contractVersion, digest, MODELS, type Assessment, type Config } from "./policy.ts"
import type { Provenance } from "./publisher.ts"
import type { Snapshot } from "./snapshot.ts"
import type { Checkpoints } from "./state.ts"

// Private controller state, never contributor evidence. Preserve a verified pass
// before final review so discussion arriving during that review cannot erase it.
export class Completeness {
  constructor(private config: Config, private checkpoints: Checkpoints) {}
  private file(snap: Snapshot) { return path.join(this.config.state_dir, "completeness", `${snap.item.number}.json`) }
  private source(snap: Snapshot) { return this.checkpoints.fingerprint(snap.item, snap.pr, []) }
  private events(snap: Snapshot) { return this.checkpoints.relevant(snap.item, snap.events).map(digest) }
  async save(snap: Snapshot, result: Assessment, provenance: Provenance) {
    if (!snap.pr || assessment(result, "completeness").state !== "continue" || provenance.model !== MODELS.completeness || provenance.verified_tools !== true || !provenance.session.startsWith("ses_")) throw new Error("Only verified passing PR completeness can be retained")
    const file = this.file(snap)
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, repository: this.config.repository, number: snap.item.number,
      contract_version: contractVersion(true), source: this.source(snap), events: this.events(snap), result, provenance }), { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }
  async load(snap: Snapshot): Promise<{ result: Assessment, provenance: Provenance } | null> {
    if (!snap.pr) return null
    let raw: string
    try { raw = await readFile(this.file(snap), "utf8") }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
    try {
      const saved = JSON.parse(raw), events = new Set(this.events(snap))
      if (saved.version !== 1 || saved.repository !== this.config.repository || saved.number !== snap.item.number ||
        saved.contract_version !== contractVersion(true) || saved.source !== this.source(snap) ||
        !Array.isArray(saved.events) || !saved.events.every((event: unknown) => typeof event === "string" && events.has(event))) return null
      const result = assessment(saved.result, "completeness"), provenance = saved.provenance
      if (result.state !== "continue" || provenance?.model !== MODELS.completeness || provenance.verified_tools !== true || !provenance.session?.startsWith("ses_")) return null
      return { result, provenance }
    } catch { return null }
  }
}
