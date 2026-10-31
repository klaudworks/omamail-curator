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

Render `@CHECKOUT@`, `@BUN@` and `@CONFIG@` in [omamail-curator.service.in](omamail-curator.service.in), install it with the timer and enable user lingering. The timer runs every 5 minutes, with sequential oldest-first processing. Logs and transcripts belong in private state storage. An old standalone reviewer OpenCode service is no longer required; stop/disable only that dedicated service after migrating.

## Maintenance and recovery

Keep the timer active during deployments. Run the whole controller/guest update inside the shared sweep lock using a controller-local script:

```sh
bun deploy/maintenance.ts --config /private/config.json -- /bin/bash /private/deploy.sh
```

The helper starts an enabled timer if previously stopped, then runs the command under the controller's existing `flock`. It waits for any current sweep; scheduled sweeps skip while maintenance owns the lock. No extra service or recovery timer is installed. The kernel releases the lock when the command and inheriting children exit, including after failure. If SSH disconnects and the command survives, it retains the lock until it exits; the timer stays active throughout. Keep the deployment command in the foreground and check its result and deployment integrity before calling an update successful. Normal processing resumes on the next five-minute tick after the lock is released.

`systemctl --user stop omamail-curator.timer` is an indefinite administrative pause, not a deployment step. `enabled` starts a unit when its user manager starts; it does not undo an explicit stop when a machine wakes or reconnects. `Persistent=true` catches missed calendar firings only once the timer is active. To resume an intentional pause, use `systemctl --user enable --now omamail-curator.timer` and verify its active state and the next sweep result.

## Moving to another server

The repository contains the controller/reviewer code and scheduler templates, but does not yet provision a fresh host or VM end to end. The controller runs on Linux; the current Mac/OrbStack operator access is not required by the runtime. A move currently needs:

- The pinned source and dependencies, the host/guest tools above, and the rendered systemd service/timer with user lingering.
- Private controller configuration, GitHub authentication and the existing checkpoint signing key. Update host-specific paths and preserve enrollment settings; the signing key lets the new controller recognize previous public assessments.
- The reviewer VM disk and its host launch/network metadata, or a separately provisioned equivalent. `vm-bridge.ts` expects `current.json`, a run directory with `launch.json`, SSH identity/known hosts and proxy configuration; adjust absolute paths and QEMU arguments for the destination. Model authentication and diagnostic toolchains belong in the guest.

Quiesce the old controller and VM before transferring their state, activate scheduling on only one controller, and verify CI gating, a real isolated reviewer run and signed publication/checkpoint reuse on the destination. Fresh-host bootstrap and automated backup/restore are still manual deployment work; migration has not been validated on a second server.
