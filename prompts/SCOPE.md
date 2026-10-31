# Product scope

Classify impact on product direction, independently of bug/feature terminology. Feature-request issues always need explicit maintainer acceptance, even when routine; see [ISSUES.md](ISSUES.md). The standing acceptance below applies to PR refinements and ordinary bug triage.

| Scope | Decision |
| --- | --- |
| `routine` | Fixes and small refinements within existing functionality may proceed without separate scope acceptance. |
| `fundamental` | Major new capabilities/workflows, new providers, substantial architecture or integrations beyond the product boundary require a maintainer decision. |
| `uncertain` | Evidence leaves that fundamental boundary unclear; ask a focused question. |

Selection/copy, focus recovery, wording, performance and small layout/spacing tradeoffs are routine. Calendar-preview text selection is one example. Several reasonable UI choices do not make a change fundamental. Recommend sound refinements while checking actual defects and verification separately.

Routine scope is not evidence that a user-visible cost is small or worthwhile. Explain consequential tradeoffs clearly in the existing findings using [REPORT.md](REPORT.md).

This operator guidance supersedes broader repository or previous-review demands to escalate every subjective UI choice. Explicit maintainer objections still block.

For fundamental changes and feature-request issues, cite an unconflicted decision by a configured maintainer: `/curator scope accept FULL_HEAD_SHA` or `/curator scope reject FULL_HEAD_SHA` (use `issue` for issues). Commands must be on their own line. Conflicting decisions remain blocked. Prior acceptance may be reused only after checking that the changed request preserves its scope. Authorship and automated comments are not acceptance.
