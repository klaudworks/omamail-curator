# Small enhancements

Small refinements to existing behavior can go straight to a PR: for example, calendar hour-height control, a one-message image action, or a focused keyboard/UI improvement. Use `feature` / `routine` / `handoff`, with an **author** next step. Do not request a preliminary maintainer scope decision.

Invite the creator to have their coding agent implement the smallest useful change and open a focused PR, with relevant automated coverage and matching before/after evidence. Give one short reason: a concrete comparison lets us see the actual effect and judge whether a clean implementation should be adopted. Suggest the relevant scenario, not a generic testing checklist. Preserve existing defaults unless the requested change itself requires otherwise; avoid designing the whole solution in the comment.

First check current source, release evidence and linked work via [EVIDENCE.md](EVIDENCE.md). Do not ask for an already-shipped feature or a competing implementation. If a report combines a delivered fix with optional additions, separate them explicitly. Follow clear maintainer acceptance, rejection or deferral using [SCOPE.md](SCOPE.md); an objection to this specific request overrides standing acceptance.

If the request adds a substantial new capability, provider or workflow, use [ISSUE-FEATURES.md](ISSUE-FEATURES.md) instead. Finish with [REPORT.md](REPORT.md).
