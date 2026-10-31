# Deployment and operations

The TypeScript controller runs on a Linux host beside QEMU. The embedded OpenCode reviewer runs inside an existing Omarchy VM. GitHub credentials and signing keys stay on the controller; model authentication stays in the trusted guest SDK host.

1. Install the mise-pinned Bun version and `bun install --frozen-lockfile --ignore-scripts` on both machines. Use Bun's x64 **baseline** build when the guest CPU lacks AVX. Install Git/FFmpeg/flock on the controller and Bubblewrap/ripgrep/bash/coreutils/Qt on the guest. Provision read-only public Rust/Cargo and Node toolchains for offline diagnostics.
2. Install this checkout, dependencies and all `prompts/` in the guest. Keep its existing OpenCode V2.2.1 authenticated database. `CURATOR_DATABASE`, `CURATOR_NODE_ROOT` and `CURATOR_TOOLCHAIN` override the guest's default runtime paths. Never put credentials in the checkout or diagnostic toolchains.
3. Copy [config.example.json](config.example.json) to private controller storage, set repository/author/maintainer/CI policy and credential paths, and set `transport` to the absolute Bun executable followed by this checkout's `deploy/vm-bridge.ts`. The token file must be 0600. Preserve an existing `checkpoint.key` across upgrades.
4. The bridge reads the existing runner's `current.json`/`launch.json`, resumes the same disk, handles clock recovery and refreshes the guest model-network tunnel. It never resets to a disposable image. Set `OMARCHY_VM_HOME` if needed. Its private guest environment defaults to `~/.local/state/omamail-curator/model.env`; `CURATOR_GUEST_ENV`, `CURATOR_GUEST_ENTRY`, `CURATOR_GUEST_BUN` and `CURATOR_GUEST_USER` are optional bridge overrides. The bridge and controller use kernel `flock` locks. No Python runtime is required by the curator.
5. Run the isolation checks in [ISOLATION.md](ISOLATION.md), then check an eligible item:

```sh
bun src/controller.ts --config /private/config.json --item NUMBER --gate-only
bun src/controller.ts --config /private/config.json --item NUMBER --dry-run
```

`--gate-only` starts no model; `--dry-run` performs a review without GitHub mutations. Remove those flags to publish. Contract-version changes force reassessment once; unchanged inputs then reuse signed checkpoints.

To include new PRs from every author, set `all_pr_authors_since` in the private controller config to a UTC ISO timestamp. PRs created at or after that instant become eligible, including their subsequent updates. Enroll individual older PRs for ongoing follow-up with `tracked_prs`, an array of positive PR numbers. Other older PRs and issues still use `authors`; updating or reopening an older PR does not enroll it. Omit both settings for authors-only operation. All other gates, including current-head CI, still apply.

Render `@CHECKOUT@`, `@BUN@` and `@CONFIG@` in [omamail-curator.service.in](omamail-curator.service.in), install it with the timer and enable user lingering. The timer runs every 5 minutes, with sequential oldest-first processing. Pause it with `systemctl --user stop omamail-curator.timer`. Logs and transcripts belong in private state storage. An old standalone reviewer OpenCode service is no longer required; stop/disable only that dedicated service after migrating.
