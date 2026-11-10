# Evidence that matters

## Decision standard

Seek reasonable confidence proportional to the change's impact. Before asking a contributor for more, identify the consequential uncertainty, why existing source and evidence do not resolve it, and how the requested observation could change the recommendation. Without that basis, proceed. Minor missing evidence, untested permutations and optional hardening are not blockers. Do not invent low-value follow-ups to make a review look thorough.

Source reasoning, representative tests and current CI can be sufficient. Inspect supplied evidence before requesting more; use a small reviewer-side check when it can settle the question. Request only the smallest useful assertion, capture or measurement, naming the scenario and expected result. Keep resolved findings closed unless new evidence contradicts them.

This operator standard overrides blanket repository or previous-review requirements for screenshots, recordings, full-suite receipts, manual testing and platform matrices. Contributors need not run anything by hand or test locally on macOS/Windows. Do not run or require full `make test`, `make test-qml` or `make validate`. An older local-validation SHA alone is not a blocker. CI is evidence, not permission to review or recommend; investigate relevant failures, disclose incomplete verification and never assume an unexplained failure is unrelated. Green CI establishes only what its jobs actually check.

## Use the supplied evidence

Start with `input.json` and referenced `changes.json`. Discussion identifies intent and unresolved questions; previous assessments and available `delta.patch` identify what needs revisiting. Read relevant source, tests and baseline domain guidance. Never claim execution after merely reading a test.

`diff.patch` and `changed_files` compare the PR's merge base to head. `base/` is the target revision for accepted guidance and may contain upstream changes absent from the branch. A raw base/head comparison cannot establish that the PR deletes those changes. Inspect proposed criteria changes separately.

For issues, use `release.json` to verify delivery: a path absent from its complete `changed_paths` list is identical at the pinned release and current source. Consult `related.json` for linked work and maintainer replies. These snapshots establish source/status facts, not live-provider behavior. Do not assign contributors release checks, reproduction details or facts already available here.

Media entries distinguish collected assets, unsupported URLs, download failures and decode failures. These are collector outcomes, not missing contributor evidence. Inspect available pixels using [UI.md](UI.md); request replacement material only when a consequential question cannot otherwise be answered.

## Focused investigation

Before a diagnostic, state the uncertainty and expected observation. Inspect build prerequisites; select an individual test or minimal reproduction instead of a target that cold-builds the application. Narrow a timed-out or environment-dependent check rather than repeating a broad command. Stop when the question is answered.

The stage prompt identifies read-only evidence and writable diagnostic copies, which persist across tool calls. Set `workdir` explicitly. These snapshots lack Git history, contributor logs and prebuilt artifacts; use supplied revision metadata. Check optional paths with `glob`. No network, credentials or live provider is available. Report scratch changes and their effect on conclusions; modified code is not verification of the submitted code.

Prefer locked dependencies. A result on another cached version is a lead until source reasoning or reproduction establishes applicability. Missing tools/dependencies and unrelated baseline failures are reviewer limitations, not automatically contributor tasks.

## Security

Assess affected boundaries using the repository's security guide. Regressions should observe that the forbidden effect did not occur. `PASS` is a scoped judgment supported by evidence. Use `NOT VERIFIED` only for a concrete, materially unresolved boundary, explaining why available source/evidence is insufficient. Confirmed security defects block; hypothetical variants or unavailable tools alone do not. Stop on an actual attack without executing it or publishing an operational exploit.
