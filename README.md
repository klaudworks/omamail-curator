# Omamail curator

A subscription-backed review assistant that enriches issues and prepares pull requests for a human maintainer.

The initial deployment watches **`huacnlee/omamail` contributions opened by `klaudworks` only**. A PR is considered only after **CI** and **Native credential contracts**, including all their jobs, succeed on its current head. Pending, missing, failed or cancelled pipelines stop before any model starts. Issues have no CI prerequisite; Omamail currently disables its issue tracker.

## Workflow

```text
30-minute tick → single-controller lock → oldest eligible item
  → opener + current-CI gate
  → relevant-input/checkpoint comparison
  → Luna xhigh: completeness, scope, evidence and blocker recheck
  → if prerequisites pass: fresh Sol xhigh substantive review
  → recheck author, current head/base, CI and discussion
  → one status comment, informational COMMENT review, permitted labels
```

The selected models are `openai/gpt-6-luna#xhigh` and `openai/gpt-6.1-sol#xhigh`, using native OpenCode ChatGPT login. No API-billed fallback is configured. Quota or authentication failures pause the sweep. There are no review-count, daily-budget or total model-duration caps. Network and diagnostic-tool deadlines still apply.

The curator never closes/reopens, merges, formally approves, requests changes, changes draft status or repairs a contribution. Its labels are `needs-information`, `needs-maintainer-decision` and exact-SHA `review-ready`. Items labeled `deferred` wait for a maintainer to remove that label. Feature/disputed-behavior scope decisions remain with maintainers. See [the maintainer workflow policy](POLICY.md).

## Runtime

- **Controller/publisher:** Python 3.11+, Git and FFmpeg on a Linux host, with a user systemd timer. It alone holds the GitHub token and checkpoint-signing key.
- **Reviewer:** pinned OpenCode V2 2.2.1 in an Omarchy VM. Native ChatGPT authentication stays in the guest, outside the diagnostic sandbox.
- **Evidence tools:** a small standard-library MCP server reads literal snapshots and downloaded public GitHub attachments. It does not load contributor plugins/configuration. Images are available to the model; videos are sampled into labeled frames, not represented as fully watched playback.
- **Investigation:** Bubblewrap exposes readonly system binaries, a fresh disposable source copy, private home/temp/processes and no network. Source builds need the appropriate preinstalled tools/dependencies; unavailable verification is reported, never passed.
- **State:** HMAC-signed checkpoints in identified GitHub comments. There is no queue/database. Private local transcripts aid diagnosis; losing the signing key requires reassessment rather than trusting unsigned history.

`gh-aw` was evaluated with its v1.0.1 compiler. Its unsupported OpenCode sample forces API-key/proxy routing and temporary auth storage; using native subscription auth on an Arch/QEMU runner also adds runner/container and cross-repository publication setup. This deployment uses the simpler local scheduler fallback. The repository does not install GitHub Actions workflows or public self-hosted runners.

## Setup

1. Clone this trusted controller repository. Run `python3 -m unittest discover -s tests -v` and `python3 -m compileall -q curator`.
2. Provision an Omarchy VM with OpenCode **2.2.1**, Python, Bubblewrap and required development tools. Sign in with `opencode auth login openai --method chatgpt-headless`. Verify both selected variants work. Use the no-JIT setting if required by QEMU emulation. Do not bake credentials into the base image.
3. Install this repository's Python files and `POLICY.md` at `~/.local/share/omamail-curator` in the guest. The guest entry point is `python3 .../curator/guest.py`; it consumes one JSON request on stdin and emits one JSON response. Its `opencode-vm` wrapper connects to the private loopback OpenCode server.
4. For the existing QEMU runner layout, install `deploy/vm-bridge.py` beside `runner.py`. It preserves the current disk, restores the allowlisted model proxy, checks the pinned server, and repairs clock drift with a same-disk reboot. Install `deploy/opencode-curator.service` as a guest user unit, adapting the environment-file path to your installation. This adapter is for the documented runner layout; another VM transport can implement the same stdin/stdout contract.
5. Copy `config.example.json` **outside the checkout**. Set `token_file`, `state_dir`, and `transport` (an argv array invoking the trusted guest bridge). The GitHub token must be mode 0600, valid for the target repository and owned by `publisher_login`. Keep the token out of the guest. The initial personal classic PAT uses `public_repo`, which is broader than comment/label authority; the deterministic publisher enforces the narrower action set.
6. Ensure the three permitted labels exist. Set the workflow paths/job expectations to the repository's actual PR pipelines; changes to these trusted prerequisites require operator review.
7. Run a read-only gate check, then a no-publication review, then a live one-item test:

```sh
python3 -m curator.controller --config /private/config.json --item 427 --gate-only
python3 -m curator.controller --config /private/config.json --item 427 --dry-run
python3 -m curator.controller --config /private/config.json --item 427
```

`--dry-run` can consume subscription quota but performs no GitHub mutations. `--gate-only` starts no models. Neither bypasses author/CI gates. Item numbers in these examples must be replaced with an authorized current test contribution.

8. Substitute `@CHECKOUT@` and `@CONFIG@` in `deploy/omamail-curator.service.in`, install it and `deploy/omamail-curator.timer` under `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now omamail-curator.timer
systemctl --user list-timers omamail-curator.timer
```

The host user manager, VM host and network must be available. Configure user lingering if operation after logout is required. Missed scheduled ticks coalesce into a sweep when the timer resumes; overlapping sweeps do not run.

## Operations

```sh
# Status and private logs
systemctl --user status omamail-curator.timer
journalctl --user -u omamail-curator.service
# Request a sweep
systemctl --user start omamail-curator.service
# Pause scheduling (an already-running sweep is unaffected)
systemctl --user stop omamail-curator.timer
# Stop an active sweep too
systemctl --user stop omamail-curator.service
```

Renew an expired GitHub token by atomically replacing its private file. Refresh ChatGPT authentication inside the guest; never substitute an API key. Retain `checkpoint.key` across controller updates and ordinary reboots. A destructive VM reset discards guest authentication and needs reprovisioning; the bridge never performs that reset. GitHub/API/model errors leave the service failed for inspection and retry at the next tick. Private `runs/` logs can be removed while no sweep is active; they are not workflow state.

Signed automation comments are excluded from human decisions. Relevant human edits/replies change the input fingerprint. Unchanged blockers do not cause repeated model work. If a comment/review write succeeds but its response is lost, the next run discovers the signed effect and completes publication without another model call. GitHub has no atomic “check inputs and comment” transaction; the publisher checks before each effect and after completion, removing stale readiness if inputs changed.

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before modifying the implementation.
