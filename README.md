# Automated issue triage and PR review for Omamail

Helps maintainers of [Omamail](https://github.com/huacnlee/omamail) understand issues and review pull requests. It checks what's missing, investigates relevant evidence, and leaves a short comment with the next useful action.

Every update has a stage title, a short summary, missing prerequisites or review findings, and one owner-labelled next step. A compact footer links the reviewed commit; final reviews also include a security verdict.

## How it works

1. Find eligible items, oldest first. PR checks must pass on the current commit.
2. Check completeness and product fit. Small refinements can proceed; fundamental direction changes need a maintainer decision.
3. When a PR is complete, use a fresh agent for final review.
4. Update one status comment and the appropriate label. Reuse previous work when nothing relevant changed.

Reviews run through OpenCode. The curator updates one comment and labels items. Maintainers control approvals, closure and merging.

Implemented in TypeScript with Bun and the OpenCode V2 SDK. See [deployment and operations](deploy/README.md) to run it.

## Find your way

- [AGENTS.md](AGENTS.md): entrypoint for coding agents improving the curator.
- [prompts/REVIEW.md](prompts/REVIEW.md): runtime entrypoint, with issue/PR routes and on-demand guidance.
- [POLICY.md](POLICY.md): controller and publication rules.
- [CONTRIBUTING.md](CONTRIBUTING.md): development checks.

Repository guidelines are read from the reviewed baseline, starting with its `AGENTS.md`; the [Omamail document map](prompts/OMAMAIL.md) links the main sources. Implementation lives in [`src/`](src/) and [`reviewer/`](reviewer/).
