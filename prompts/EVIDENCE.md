# Verify the claim

## Verification policy

Contributors are not required to test anything by hand. Use automated tests, reproducible diagnostics and generated visual evidence for the changed behavior. Do not require contributor or reviewer testing on macOS or Windows. Missing hands-on or macOS/Windows results are not blockers or next steps; discard previous requests for them. This operator policy overrides older baseline manual-testing and platform-matrix requirements. Applicable Linux automated checks and the controller's CI gate still apply. Report what the evidence actually verifies.

Inspect existing coverage and use targeted investigation before asking for more. A real verification gap must identify the scenario, expected observable result and smallest automated regression or capture the contributor's agent can add. Do not substitute a generic checklist, human retest or unavailable reviewer capability for a concrete gap.

The existing current-head CI gate is the verification baseline. Do not introduce a requirement for full `make test-qml`, `make test` or `make validate` results, and do not block solely because a local-validation note names an older SHA. This operator policy overrides broader repository validation prerequisites for curator review. Discard previous blockers that ask only for full-suite or current-SHA validation receipts. Green CI proves only the checks it actually executes; investigate a concrete uncertainty in changed behavior with a focused diagnostic, and request additional evidence only for a specific unresolved scenario.

## Investigation

Use the evidence index in `input.json`. Open details only for the question being decided:

- Discussion: intent, objections, new proof and resolved findings.
- Previous assessment and `delta.patch`: which claims changed; open the delta only when the index lists it. Same-head reassessments may have no delta. Reassess the full diff when needed.
- CI: controller-verified current-head workflow/job receipts. Do not ask to repeat already-successful pipelines.
- Source and tests: inspect changed behavior and relevant callers/contracts before running diagnostics. Read domain guidance linked from baseline `AGENTS.md` as needed.
- Attachments: inspect only relevant media; [UI.md](UI.md) explains their limits.

Start with supplied evidence, then use native source tools or a targeted `shell` command to answer remaining questions within the stage's remit. Before execution, state the concrete uncertainty and expected observation; inspect build prerequisites and avoid rerunning successful broad CI. A timeout or baseline/environment failure calls for narrowing the diagnostic, not blindly retrying the entire target without a timeout. Stop once the relevant question is answered.

The stage prompt identifies read-only evidence and writable head/base diagnostic copies. These are source snapshots without `.git`, contributor-local logs or prebuilt artifacts; revision identities are in `input.json`. Copies persist across tool calls within this stage; set `workdir` explicitly. Native `patch`, `edit` and `write` can prepare diagnostic fixtures there. No external network, credentials or live provider is available. Report modifications when using scratch changes for diagnosis; they are not a pass for submitted code. Check optional paths with `glob` before reading them.

Check only affected security boundaries. Read the repository's security guide when relevant; a regression must show the forbidden effect did not occur. Missing tools or proof means not verified, never success. Stop on an actual attack; do not run it or publish operational exploits.

Inspect proposed changes to review criteria separately from the baseline.
