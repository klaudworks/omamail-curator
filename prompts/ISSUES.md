# Issues

Find the next useful action; an issue need not contain a finished implementation.

1. Read the report and relevant discussion. If a prior assessment exists, check whether its unresolved questions have been answered before repeating investigation.
2. For a bug, establish expected versus actual behavior and the smallest reproduction. Ask only for information needed to investigate; use [EVIDENCE.md](EVIDENCE.md) when verification would resolve uncertainty.
3. For a feature or disputed behavior, apply [SCOPE.md](SCOPE.md). Routine refinements can receive `handoff`; fundamental direction changes need a maintainer decision.
4. For support, give useful usage/configuration guidance. A reproducible defect discovered there enters bug handling. An already-fixed claim requires evidence before `verified-fixed`.

Use `needs-information` for a concrete unanswered question. Issues have no PR CI requirement and never use `continue` or `ready`. Closure and duplicate handling remain human decisions.

Finish with [REPORT.md](REPORT.md).
