# Pull requests

Read baseline `CONTRIBUTING.md` and relevant discussion. It defines contribution and verification requirements, subject to the operator verification policy in [EVIDENCE.md](EVIDENCE.md); read that guide in either stage. The controller already verified author eligibility and current CI; do not ask to rerun successful pipelines.

## Completeness stage

Understand the change and beneficiaries. Check previous blockers and the relevant delta first; reuse unaffected evidence and discard obsolete scope blockers. A commit alone does not justify repeating investigation.

Apply [SCOPE.md](SCOPE.md), then inspect the required evidence using [EVIDENCE.md](EVIDENCE.md) and [UI.md](UI.md) when applicable. Decide whether the problem, scope, implementation and supplied verification are sufficiently documented for independent final review. Stop as soon as an actionable missing prerequisite is established. A complete PR gets `continue`, never `ready`.

This stage checks prerequisites. Do not run repository-wide builds, test suites, lint or validation targets, or cold-build dependencies. Read the relevant source/tests and match current-head CI to the claimed coverage first. Do not try to supply missing contributor validation by executing it yourself during completeness. A diagnostic is appropriate only when one narrowly scoped prerequisite remains ambiguous and the smallest focused check can resolve it. Leave independent correctness/security investigation and regression execution to final review. Do not investigate unrelated baseline failures during completeness.

## Final stage

Independently inspect the current diff and evidence. The completeness assessment and prior reviews are context, not proof. Focus on substantive deltas while verifying current-revision claims.

Use focused diagnostics for concrete uncertainties left by source, supplied evidence and current-head CI. Inspect a command's prerequisites before running it: a UI-test target may first compile the entire backend. Run individual tests/functions or minimal reproductions. Do not execute full repository suites such as `make test-qml`, `make test` or `make validate`, or make their absence a review blocker. Follow the verification policy in [EVIDENCE.md](EVIDENCE.md).

Assess product fit, interaction design, correctness, regressions, performance and affected security boundaries. Every finding needs evidence of what fails, who is affected and what resolves it. Use `ready` only with no blockers and security `PASS`; otherwise identify the actual defect, missing proof or fundamental product decision.

Finish either stage with [REPORT.md](REPORT.md). Recommendations are informational; never formally approve or request changes.
