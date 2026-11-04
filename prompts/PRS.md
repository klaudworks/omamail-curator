# Pull requests

Read baseline `CONTRIBUTING.md`, relevant discussion and [EVIDENCE.md](EVIDENCE.md) in either stage. The operator evidence standard takes precedence over blanket verification requirements. Open [SCOPE.md](SCOPE.md) for substantial/disputed scope or recorded scope commands, and [UI.md](UI.md) for UI changes. Then follow only your stage below.

## Completeness

Decide whether final review can usefully judge the contribution, not whether every requested artifact exists. Check the problem, scope, implementation and relevant evidence in one lightweight pass. Start with `changes.json`, previous findings and the current delta; retain unaffected evidence. A routing decision to revisit completeness is not proof of a missing prerequisite.

Use `continue` when source and available evidence make the change assessable, even if minor evidence is absent. Leave independent correctness/security investigation to final review. Ask for information only when a consequential gap prevents that review; collect all such gaps into one specific request. Do not require a recording to repeat behavior already established by code and tests.

CI may still be pending or unsuccessful; that alone does not block completeness. Read source and supplied evidence without cold builds or full suites. A minimal diagnostic is appropriate only to resolve a genuinely ambiguous entry prerequisite. Do not investigate unrelated baseline failures or manufacture missing contributor validation.

## Final review

Independently inspect the current diff, evidence and affected callers. Prior assessments are context, not proof. Assess product fit, interaction, correctness, performance and affected security boundaries. Use focused diagnostics only for consequential uncertainties left by source, supplied evidence and current CI.

Completeness may have passed on an earlier revision. Revisit prerequisites only for material scope changes, withdrawn essential evidence or a specific newly relevant gap. Ordinary follow-ups do not restart the checklist. Check requested fixes and risks introduced by the delta; report all known substantive blockers together. Stop when the evidence supports a recommendation.

Use `ready` only with no blockers and scoped security `PASS`. Block on demonstrated consequential defects or a credible material risk supported by evidence; distinguish those from missing proof and product decisions. Optional improvements and merely untested cases do not block readiness.

Finish with [REPORT.md](REPORT.md). The controller gates final review/publication on current-head CI. Recommendations are informational; never formally approve, request changes or merge.
