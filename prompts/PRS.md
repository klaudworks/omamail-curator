# Pull requests

Read baseline `CONTRIBUTING.md` and relevant discussion. It defines contribution and verification requirements, subject to the operator verification policy in [EVIDENCE.md](EVIDENCE.md); read that guide in either stage. The controller verified author eligibility. Successful current-head CI is required before final review, not completeness; do not infer a CI pass from entry into completeness or ask to rerun successful pipelines.

## Completeness stage

Understand the change and beneficiaries. Check `changes.json` when supplied, previous blockers and the relevant delta first; reuse unaffected evidence and discard obsolete scope blockers. A commit alone does not justify repeating investigation. If routing revisits a previously passed completeness milestone, identify the changed prerequisite and check that gap while retaining unaffected evidence; the routing decision is not proof that evidence is missing.

Apply [SCOPE.md](SCOPE.md), then inspect the required evidence using [EVIDENCE.md](EVIDENCE.md) and [UI.md](UI.md) when applicable. Before reporting, complete a lightweight pass over all applicable prerequisites: problem/reproduction, scope, implementation, relevant regression evidence, and required visual/workflow evidence. Check the description, discussion and evidence index for material already supplied. Collect all concrete missing prerequisites into one actionable request instead of stopping at the first gap. Explain the scenario and expected evidence for each omission; do not add speculative requirements or expand into final review. A complete PR gets `continue`, never `ready`.

This stage checks prerequisites independently of CI progress. Pending, missing or unsuccessful CI alone is not a completeness blocker; a passing completeness result is retained while the controller waits for CI before final review. Do not run repository-wide builds, test suites, lint or validation targets, or cold-build dependencies. Read the relevant source/tests and supplied evidence without assuming uncollected CI ran. Do not try to supply missing contributor validation by executing it yourself during completeness. A diagnostic is appropriate only when one narrowly scoped prerequisite remains ambiguous and the smallest focused check can resolve it. Leave independent correctness/security investigation and regression execution to final review. Do not investigate unrelated baseline failures during completeness.

## Final stage

Judge reasonable confidence to merge, proportional to the change's impact and risk. Representative regression evidence, source reasoning and current CI can be sufficient; do not seek exhaustive input coverage or certainty about every possible edge case. Block on a concrete consequential defect, a credible material risk supported by evidence, or a specific gap that prevents assessing an affected security boundary. Optional hardening, minor improvements and merely untested permutations do not block readiness.

Independently inspect the current diff and evidence. The completeness assessment and prior reviews are context, not proof. Focus on substantive deltas while verifying current-revision claims. For UI changes, follow [UI.md](UI.md)'s visual inspection workflow alongside focused interaction tests.

Completeness is an entry milestone and may have passed on an earlier revision. Ordinary follow-up commits, description updates and discussion retain it unless the stage-aware relevance gate routes changed prerequisites back to completeness. Revisit prerequisites here too when scope materially changes or required evidence is removed; apply [SCOPE.md](SCOPE.md) to the current change and request concrete missing evidence or a maintainer decision when needed. A retained pass never establishes current scope acceptance, correctness, security or readiness.

Use focused diagnostics for concrete uncertainties left by source, supplied evidence and current-head CI. Inspect a command's prerequisites before running it: a UI-test target may first compile the entire backend. Run individual tests/functions or minimal reproductions. Do not execute full repository suites such as `make test-qml`, `make test` or `make validate`, or make their absence a review blocker. Follow the verification policy in [EVIDENCE.md](EVIDENCE.md).

Complete a bounded pass over the affected behavior and report all known actionable blockers together. On follow-up, check the requested fixes and risks introduced by the new changes; keep resolved findings closed unless new evidence contradicts them. Do not restart an unrestricted search or add another test category merely because the previous request was satisfied. Stop when the evidence supports the recommendation; a newly demonstrated consequential defect still warrants reporting.

Assess product fit, interaction design, correctness, regressions, performance and affected security boundaries. Every finding needs evidence of what fails, who is affected and what resolves it. Use `ready` only with no blockers and security `PASS`; otherwise identify the actual defect, missing proof or fundamental product decision.

Finish either stage with [REPORT.md](REPORT.md). Recommendations are informational; never formally approve or request changes.
