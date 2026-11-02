# Automated issue triage and PR review for Omamail

Helps maintainers of [Omamail](https://github.com/huacnlee/omamail) understand issues and review pull requests. It checks what's missing, investigates relevant evidence, and leaves a short comment with the next useful action.

Issue replies are short natural comments with an automated-curator attribution. PR reports have a stage title, findings, one owner-labelled next step and a reviewed-commit footer; final reviews also include a security verdict.

## How it works

1. Find eligible items, oldest first. PR completeness can run while CI is pending; final review waits for successful checks on the current commit.
2. Triage issues as bugs (`bug`), enhancements (`enhancement`), or support/disputed behavior (`question`). Verify available source, release and discussion evidence. Tag the creator for missing details or invite their coding agent to prepare a focused fix/enhancement PR with before/after evidence. Larger product changes go to maintainers for a specific scope question; ordinary replies record their decisions.
3. Retain passing completeness, then use a fresh agent for final review once current-commit CI succeeds.
4. Post one initial issue assessment and one comment per completed PR assessment. Update category/status labels. Optional Jev decisions skip nonmaterial updates; useful changed issue answers get a follow-up comment. Unchanged polling reuses work without model calls or another comment.

Reviews run through OpenCode. The curator posts normal comments and labels items. Maintainers control approvals, closure and merging.

Bug clarification requests include a copy-paste diagnostic prompt and instructions to update the issue using `gh`. Explicit maintainer deferrals receive `deferred`; declined proposals receive `wontfix`. No issue is closed automatically. The [issue index](prompts/ISSUES.md) routes to short type-specific guides.

Implemented in TypeScript with Bun and the OpenCode V2 SDK. See the [setup guide](docs/setup.md) to install and operate it.

## Find your way

- [AGENTS.md](AGENTS.md): entrypoint for coding agents improving the curator.
- [prompts/REVIEW.md](prompts/REVIEW.md): runtime entrypoint, with issue/PR routes and on-demand guidance.
- [POLICY.md](POLICY.md): controller and publication rules.
- [CONTRIBUTING.md](CONTRIBUTING.md): development checks.

Repository guidelines are read from the reviewed baseline, starting with its `AGENTS.md`; the [Omamail document map](prompts/OMAMAIL.md) links the main sources. Implementation lives in [`src/`](src/) and [`reviewer/`](reviewer/).
