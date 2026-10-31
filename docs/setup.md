# Setup and operations

The curator has two parts:

- **Controller:** a Linux host running the five-minute systemd timer, GitHub collection and publication.
- **Reviewer:** an Omarchy VM running the embedded OpenCode SDK, with investigation tools isolated by Bubblewrap.

GitHub credentials and the checkpoint signing key stay on the controller. Model authentication stays in the guest. This guide assumes an existing VM; fresh VM provisioning is still manual.

## 1. Install the runtime

Check out the same curator revision on the controller and guest. Install Bun 1.4.3 (pinned in [mise.toml](../mise.toml)), then run in both checkouts:

```sh
bun install --frozen-lockfile --ignore-scripts
```

Use Bun's x64 baseline build if the guest CPU lacks AVX.

| Controller tools | Guest tools |
| --- | --- |
| systemd, QEMU, OpenSSH, tinyproxy, Git, FFmpeg, tar, flock | Bubblewrap, ripgrep, bash, coreutils, tar, Qt, compiler/build tools |

The guest also needs an authenticated OpenCode database and public Rust/Cargo and Node toolchains, including dependencies for offline diagnostics. Keep credentials outside the checkout and toolchain directories. See [reviewer isolation](../deploy/ISOLATION.md) for the filesystem boundary and verification steps.

## 2. Connect the reviewer VM

The [VM bridge](../deploy/vm-bridge.ts) uses `~/omamail-vm` by default; override it with `OMARCHY_VM_HOME`. It expects:

- `current.json`: the absolute VM run `directory` and forwarded `ssh_port`.
- A run directory under `runs/`, containing `launch.json` with the QEMU `argv`, an SSH key (`id_ed25519`), `known_hosts`, and `auth-network/tinyproxy.conf`.
- QEMU launch arguments that create `qemu.pid` and `qmp.sock` in that directory and forward the guest SSH port.

The bridge resumes the existing disk, recovers the guest clock and refreshes the model-network tunnel. Guest defaults are:

| Setting | Default |
| --- | --- |
| `CURATOR_GUEST_USER` | `omarchy` |
| `CURATOR_GUEST_ENTRY` | `$HOME/.local/share/omamail-curator/src/guest.ts` |
| `CURATOR_GUEST_BUN` | `$HOME/.local/opt/bun/1.4.3/bin/bun` |
| `CURATOR_GUEST_ENV` | `$HOME/.local/state/omamail-curator/model.env` |

The private guest environment supplies model authentication/network settings. Use `CURATOR_DATABASE`, `CURATOR_NODE_ROOT` and `CURATOR_TOOLCHAIN` there to override the reviewer's database and toolchain paths.

## 3. Configure and verify

Copy [config.example.json](../deploy/config.example.json) to private controller storage. Set the repository, publisher, maintainers, CI workflows and absolute credential/state paths. Set `transport` to the absolute Bun executable followed by the absolute path to `deploy/vm-bridge.ts`. Give the GitHub token file mode `0600`.

Enrollment is controlled by:

- `authors`: allowed authors of issues and PRs.
- `all_pr_authors_since`: optional UTC creation-time cutoff admitting new PRs from any author.
- `tracked_prs`: optional PR numbers to enroll older contributions explicitly.

Run the isolation checks linked above, then check an eligible PR from the controller checkout:

```sh
bun src/controller.ts --config /private/config.json --item NUMBER --gate-only
bun src/controller.ts --config /private/config.json --item NUMBER --dry-run
```

`--gate-only` checks eligibility and current-head CI without starting a model. `--dry-run` assesses changed inputs without publishing; unchanged inputs can reuse a signed checkpoint. Check the reported outcome as well as the exit code.

## 4. Enable scheduling

Replace `@CHECKOUT@`, `@BUN@` and `@CONFIG@` in the [service template](../deploy/omamail-curator.service.in) with absolute paths. Install it as `~/.config/systemd/user/omamail-curator.service`, alongside [omamail-curator.timer](../deploy/omamail-curator.timer). Then run as the controller user:

```sh
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now omamail-curator.timer
systemctl --user list-timers omamail-curator.timer
journalctl --user -u omamail-curator.service -n 30
```

Sweeps run every five minutes, oldest first and sequentially. A long review delays later items. Verify a completed sweep and its published outcome; an active timer alone does not establish that reviews work.

## Maintenance and recovery

**Leave the timer running during deployments.** Put the whole controller/guest update in a foreground script and run it through the existing sweep lock:

```sh
bun deploy/maintenance.ts --config /private/config.json -- /bin/bash /private/deploy.sh
```

The helper waits for the current sweep; new sweeps skip while maintenance holds the lock. The lock is released when the command and inheriting children exit, including after failure. If a command survives an SSH disconnect, it keeps the lock until it exits. Check the deployment result; normal processing resumes on a later timer tick.

An explicit `systemctl --user stop omamail-curator.timer` stays stopped after wake or reconnection. `enabled` applies when the user manager starts; `Persistent=true` catches missed firings when the timer is active. To resume an intentional pause:

```sh
systemctl --user enable --now omamail-curator.timer
```

## Move to another server

1. Provision the host tools and reviewer VM described above. Mac/OrbStack operator access is not required by the runtime.
2. Stop scheduling on the old controller and let its current sweep finish. Shut down the VM before copying its disk and launch/network metadata.
3. Transfer private controller configuration/state and GitHub authentication. **Preserve `checkpoint.key`** so existing assessments remain recognizable. Retain guest model authentication and toolchains; update absolute paths and QEMU arguments for the new host.
4. Repeat verification, then enable scheduling only on the destination. Confirm a real review and signed publication/checkpoint reuse.

Host/VM provisioning and state transfer are currently manual; migration has not yet been validated on a second server.
