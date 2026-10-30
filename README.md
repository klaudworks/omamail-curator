# Omamail curator

Helps maintainers of [Omamail](https://github.com/huacnlee/omamail) understand issues and review pull requests. It checks what's missing, investigates relevant evidence, and leaves a short comment with the next useful action.

Every update uses the same format: **Status · Summary · Findings · Next step**, naming who should act and what they should do. Completeness requests and final reviews are labeled explicitly.

## How it works

1. Find eligible items, oldest first. PR checks must pass on the current commit.
2. Check completeness and product fit. Small refinements can proceed; fundamental direction changes need a maintainer decision.
3. When a PR is complete, use a fresh agent for final review.
4. Update one status comment and the appropriate label. Reuse previous work when nothing relevant changed.

Reviews use OpenCode with ChatGPT subscription authentication. Quota or runtime failures pause processing; there is no paid fallback. The curator can comment, leave informational reviews and label items. Maintainers control approvals, closure and merging.

## Run it

The Python controller runs on a Linux host; OpenCode and isolated investigation run in a VM. Keep GitHub credentials on the controller host.

- Configure the repository, eligibility, CI requirements and VM transport using [deploy/config.example.json](deploy/config.example.json). Store the real configuration and credentials outside the checkout.
- Install the guest runtime together with the entire `prompts/` directory. See [deploy/](deploy/) for the VM bridge and service definitions.
- Check one item before enabling the 30-minute timer:

```sh
python3 -m curator.controller --config /private/config.json --item NUMBER --gate-only
python3 -m curator.controller --config /private/config.json --item NUMBER --dry-run
```

`--gate-only` uses no model. `--dry-run` reviews without publishing. Remove those flags to publish. Pause scheduled work with `systemctl --user stop omamail-curator.timer`.

## Find your way

- [AGENTS.md](AGENTS.md): entrypoint for coding agents improving the curator.
- [prompts/REVIEW.md](prompts/REVIEW.md): runtime entrypoint, with issue/PR routes and on-demand guidance.
- [POLICY.md](POLICY.md): controller and publication rules.
- [CONTRIBUTING.md](CONTRIBUTING.md): development checks.

Repository guidelines are read from the reviewed baseline, starting with its `AGENTS.md`; the [Omamail document map](prompts/OMAMAIL.md) links the main sources. Implementation details live in [`curator/`](curator/).
