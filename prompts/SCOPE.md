# Product scope

Classify impact on product direction, independently of bug/feature terminology. Routine bug fixes and small enhancements have standing acceptance to be proposed as focused PRs; substantial new capabilities need discussion first.

| Scope | Decision |
| --- | --- |
| `routine` | Fixes and small refinements within existing functionality may proceed without separate scope acceptance. |
| `fundamental` | Major new capabilities/workflows, new providers, substantial architecture or integrations beyond the product boundary require a maintainer decision. |
| `uncertain` | Evidence leaves that fundamental boundary unclear; ask a focused question. |

Selection/copy, focus recovery, wording, performance and small layout/spacing tradeoffs are routine. Calendar-preview text selection is one example. Several reasonable UI choices do not make a change fundamental. Recommend sound refinements while checking actual defects and verification separately.

Routine scope is not evidence that a user-visible cost is small or worthwhile. Explain consequential tradeoffs clearly in the existing findings using [REPORT.md](REPORT.md).

This operator guidance supersedes broader repository or previous-review demands to escalate every subjective UI choice. Explicit maintainer objections still block.

## Issues

Ordinary explicit maintainer replies are decisions; no command is required. Read the whole discussion, including later corrections. Cite a decision only from a configured maintainer's non-curator comment on this issue, using `issue_decision` with its disposition and exact supporting quotations. The controller verifies the comment identity and quote. Keep `scope_decisions: []` for issues.

- `accepted`: the maintainer clearly welcomes the specific direction, or confirms it was accepted and shipped. Preserve any limits; acceptance of one part is not acceptance of optional additions.
- `rejected`: the requested direction was explicitly declined. Use `declined`, with no-action ownership; explain the concrete accepted alternative if one was stated. Do not ask the maintainer to reject it again.
- `deferred`: implementation was explicitly postponed. Use `deferred`, with no-action ownership; the controller labels it deferred and pauses processing until a maintainer removes that label.

Do not infer acceptance merely from authorship, politeness, a question, or automated comments. Ambiguous or conflicting replies need a specific clarification, not a formal-command request. If an earlier decision was explicitly superseded, cite the resolving reply. A shipped fix is not a fresh scope proposal; verify its delivery using [EVIDENCE.md](EVIDENCE.md). Keep already-delivered behavior separate from any outstanding additions.

## PRs

For fundamental PR changes, cite an unconflicted decision by a configured maintainer: `/curator scope accept FULL_HEAD_SHA` or `/curator scope reject FULL_HEAD_SHA`. Commands must be on their own line. Conflicting decisions remain blocked. Prior acceptance may be reused only after checking that the delta preserves its scope. Authorship and automated comments are not acceptance.
