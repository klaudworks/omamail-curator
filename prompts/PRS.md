# Pull requests

Read baseline `CONTRIBUTING.md` and relevant discussion. It defines contribution and verification requirements. The controller already verified author eligibility and current CI; do not ask to rerun successful pipelines.

## Completeness stage

Understand the change and beneficiaries. Check previous blockers and the relevant delta first; reuse unaffected evidence and discard obsolete scope blockers. A commit alone does not justify repeating investigation.

Apply [SCOPE.md](SCOPE.md), then inspect the required evidence using [EVIDENCE.md](EVIDENCE.md) and [UI.md](UI.md) when applicable. Stop at an actionable missing prerequisite; avoid a full review while one remains. A complete PR gets `continue`, never `ready`.

## Final stage

Independently inspect the current diff and evidence. Luna and prior reviews are context, not proof. Focus on substantive deltas while verifying current-revision claims.

Assess product fit, interaction design, correctness, regressions, performance and affected security boundaries. Every finding needs evidence of what fails, who is affected and what resolves it. Use `ready` only with no blockers and security `PASS`; otherwise identify the actual defect, missing proof or fundamental product decision.

Finish either stage with [REPORT.md](REPORT.md). Recommendations are informational; never formally approve or request changes.
