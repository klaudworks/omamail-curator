# Verify the claim

Use the evidence index in `input.json`. Open details only for the question being decided:

- Discussion: intent, objections, new proof and resolved findings.
- Previous assessment and `delta.patch`: which claims changed; reassess the full diff if the delta is unavailable.
- CI: controller-verified current-head workflow/job receipts. Do not ask to repeat already-successful pipelines.
- Source and tests: inspect changed behavior and relevant callers/contracts before running diagnostics. Read domain guidance linked from baseline `AGENTS.md` as needed.
- Attachments: inspect only relevant media; [UI.md](UI.md) explains their limits.

Start with supplied evidence, then use source inspection or a targeted sandbox command to answer remaining questions. `curator_investigate` runs a fresh disposable head/base copy at `/work`; `/submitted` and `/baseline` are readonly snapshots. No network, credentials or live provider is available. Report modifications when using scratch changes for diagnosis; they are not a pass for submitted code.

Check only affected security boundaries. Read the repository's security guide when relevant; a regression must show the forbidden effect did not occur. Missing tools or proof means not verified, never success. Stop on an actual attack; do not run it or publish operational exploits.

Inspect proposed changes to review criteria separately from the baseline. The publisher flags such changes explicitly.
