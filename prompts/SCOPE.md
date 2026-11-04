# Product scope

Classify product impact independently of bug/feature terminology. This operator guidance overrides blanket demands to escalate subjective UI choices; specific maintainer objections still block.

| Scope | Treatment |
| --- | --- |
| `routine` | Existing-functionality fixes/refinements have standing acceptance. Selection/copy, focus, wording, performance and minor layout choices belong here. |
| `fundamental` | Major capabilities/workflows, providers, architecture changes or integrations beyond the product boundary need a maintainer decision. |
| `uncertain` | That fundamental boundary is genuinely unclear; ask the focused question. |

Several reasonable design choices do not make a change fundamental. Routine scope does not prove a tradeoff is worthwhile; explain consequential costs in the findings under [REPORT.md](REPORT.md).

## Issues

Ordinary explicit maintainer replies count. Read the whole discussion and later corrections. Cite only configured maintainers' non-curator comments on this issue, with exact quotations in `issue_decision`; keep `scope_decisions: []`. The controller verifies ownership and quotes.

- `accepted`: welcomes the specific direction or confirms it was accepted and shipped. Preserve limits; one accepted part does not authorize optional additions.
- `rejected`: explicitly declines it. Use `declined`, owner `none`; do not ask for rejection again.
- `deferred`: explicitly postpones implementation. Use `deferred`, owner `none`; processing pauses until a maintainer removes the label.

Authorship, politeness, questions and automated comments are not acceptance. Openness or “no objection” permits exploration, not final adoption; preserve it without another approval demand. Answer feasible factual questions before requesting implementation choices. Clarify ambiguity only when it blocks the next useful step. Verify shipped behavior under [EVIDENCE.md](EVIDENCE.md), separating outstanding additions.

## PRs

Fundamental changes need an unconflicted configured-maintainer command on its own line: `/curator scope accept FULL_HEAD_SHA` or `/curator scope reject FULL_HEAD_SHA`. Cite its comment ID. Conflicts block; reuse earlier acceptance only when the delta preserves its scope. Authorship and automated comments do not establish acceptance.
