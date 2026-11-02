# Verify the claim

## Verification policy

Contributors are not required to test anything by hand. Use automated tests, reproducible diagnostics and generated visual evidence for the changed behavior. Do not require contributor or reviewer testing on macOS or Windows. Missing hands-on or macOS/Windows results are not blockers or next steps; discard previous requests for them. This operator policy overrides older baseline manual-testing and platform-matrix requirements. Applicable Linux automated checks and the controller's CI gate still apply. Report what the evidence actually verifies.

Inspect existing coverage and use targeted investigation before asking for more. A real verification gap must identify the scenario, expected observable result and smallest automated regression or capture the contributor's agent can add. Do not substitute a generic checklist, human retest or unavailable reviewer capability for a concrete gap.

Ask whether more evidence could materially change the merge decision. Uncertainty alone is not a missing prerequisite: weigh the supported failure mechanism, plausible impact, existing safeguards and representative coverage. Do not require a full format/platform/size matrix or another benchmark merely to raise confidence beyond what is reasonable for the change.

The current-head CI gate is required before final review and final publication. Completeness checks prerequisites independently of CI; absent CI receipts at that stage establish neither success nor failure. Do not introduce a requirement for full `make test-qml`, `make test` or `make validate` results, and do not block solely because a local-validation note names an older SHA. This operator policy overrides broader repository validation prerequisites for curator review. Discard previous blockers that ask only for full-suite or current-SHA validation receipts. Green CI proves only the checks it actually executes; investigate a concrete uncertainty in changed behavior with a focused diagnostic, and request additional evidence only for a specific unresolved scenario.

## Investigation

For issues, verify facts that the supplied materials can establish before assigning work to anyone. Read `release.json` when delivery matters: it identifies the published pinned backend tag, its source revision, and a complete Git changed-path list against the current source; `release.patch` supplies bounded differences when available. A source path absent from that complete list is identical at the release revision. This establishes source/release inclusion, not a live-provider test. Read relevant entries in `related.json` for linked issue/PR status and maintainer replies. These are collection-time snapshots, not guarantees of future state. If a lookup is unavailable, say exactly what is unknown rather than calling it missing contributor evidence.

Check a claimed fix against the actual current/released source and existing regression coverage. Run a small relevant diagnostic when it can resolve a concrete uncertainty. Do not request a maintainer check of a release fact that is supplied, or an author reproduction detail already present in the report or screenshot. Do not claim you ran a test after only reading it. Historical comments are leads, not current-source proof. These evidence trees have no Git history; use the supplied revision/release metadata rather than `git log` or `git tag` in a snapshot.

Use the evidence index in `input.json`. Open details only for the question being decided:

- Discussion: intent, objections, new proof and resolved findings.
- Previous assessment and `delta.patch`: which claims changed; open the delta only when the index lists it. Same-head reassessments may have no delta. Reassess the full diff when needed.
- CI: controller-verified current-head workflow/job receipts. Do not ask to repeat already-successful pipelines.
- Source and tests: inspect changed behavior and relevant callers/contracts before running diagnostics. Read domain guidance linked from baseline `AGENTS.md` as needed.
- Attachments: inspect only relevant media; [UI.md](UI.md) explains their limits.

`changed_files` and `diff.patch` describe the PR's merge-base-to-head changes, identified by `input.json`'s `comparison`. `base/` contains the target-branch revision for accepted project guidance; it can include upstream changes absent from the contributor's branch. A raw comparison of `base/` and `head/` therefore does not establish what the PR changes. Confirm alleged deletions or criteria changes against the supplied PR patch, including when reconsidering a previous finding; do not ask contributors to restore upstream-only changes.

Start with supplied evidence, then use native source tools or a targeted `shell` command to answer remaining questions within the stage's remit. Before execution, state the concrete uncertainty and expected observation; inspect build prerequisites and avoid rerunning successful broad CI. A timeout or baseline/environment failure calls for narrowing the diagnostic, not blindly retrying the entire target without a timeout. Stop once the relevant question is answered.

The stage prompt identifies read-only evidence and writable head/base diagnostic copies. These are source snapshots without `.git`, contributor-local logs or prebuilt artifacts; revision identities are in `input.json`. Copies persist across tool calls within this stage; set `workdir` explicitly. Native `patch`, `edit` and `write` can prepare diagnostic fixtures there. No external network, credentials or live provider is available. Report modifications when using scratch changes for diagnosis; they are not a pass for submitted code. Check optional paths with `glob` before reading them.

Prefer the submitted locked dependencies for diagnostics. Results on a different cached version are leads: establish applicability to the submitted version through current source reasoning or a focused reproduction before treating them as a blocker. Missing dependencies or failed local setup are reviewer limitations, not automatically contributor work. Use supplied evidence and source inspection where sufficient; request additional proof only for a remaining concrete, consequential uncertainty.

Check only affected security boundaries. Read the repository's security guide when relevant; a regression must show the forbidden effect did not occur. Security PASS is a scoped, evidence-supported judgment, not proof against every possible input. Use NOT VERIFIED when a concrete affected boundary remains materially unassessed, naming why the available source and evidence are insufficient; an unavailable tool or hypothetical untested variant alone does not establish that gap. Confirmed security failures still block. Stop on an actual attack; do not run it or publish operational exploits.

Inspect proposed changes to review criteria separately from the baseline.
