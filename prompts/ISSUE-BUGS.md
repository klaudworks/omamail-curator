# Bug reports

Read the discussion and previous assessment before repeating a question. Verify accessible facts using [EVIDENCE.md](EVIDENCE.md), including whether an alleged fix is in the pinned release. A proposed cause is not an observed cause. Split an existing-behavior defect from optional feature additions; do not route the defect to product approval merely because a report also suggests a preference.

If information essential to investigation is missing, use `bug` / `needs-information` with an author next step. Ask together for only the missing reproduction steps, expected versus actual result, relevant environment or exact error. Do not ask again for details already supplied. Inspect an attached screenshot before asking for information it might show. Request a minimal sanitized example rather than real mail or credentials.

Include an `author_prompt` the creator can paste into their coding agent. Describe the exact ambiguous scenario, what to inspect or reproduce, the specific UI states to capture when screenshots would help, and the observations to report. Have the agent collect accessible version/source/log facts and ask the user only for facts it cannot observe; never invent a reproduction or successful result. Prefer synthetic mail/account data for captures. Keep this a focused diagnostic request, not an instruction to rewrite the app or run a full suite. The publisher appends the exact issue URL and `gh issue comment --body-file` instructions, including the separate image-upload step. Do not duplicate that boilerplate in the prompt.

Once actionable, use `bug` / `routine` / `handoff` with an **author** next step. Invite the creator to point their coding agent at the report and open a focused fix PR; this is an invitation, not a condition for reporting a bug. Name the concrete behavior and useful regression evidence. For visible or performance changes, request a matched before/after capture or measurement of that scenario: seeing the actual difference lets reviewers judge the fix. Do not delegate implementation or routine investigation to maintainers, or request a full suite or mandatory hands-on testing.

Recognize partial and completed fixes. Keep a partial report focused on the outstanding behavior; do not invite a competing PR when a linked open PR already covers it. For a verified shipped fix, use `verified-fixed` and explain the affected version and scope; do not invent a missing live-provider retest or another release-confirmation chore. Closure remains a human choice.

Finish with [REPORT.md](REPORT.md).
