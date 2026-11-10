# Pull requests

One independent session checks essential inputs, then investigates if assessable. CI is evidence, not permission to start or finish. Read baseline `CONTRIBUTING.md`, discussion, `changes.json`, the diff, CI observations and [EVIDENCE.md](EVIDENCE.md). Open [SCOPE.md](SCOPE.md) for substantial/disputed scope and [UI.md](UI.md) for UI changes.

## First: assess essential inputs

Briefly scan the whole contribution: problem, scope, affected behavior, supplied verification and outstanding findings. Ask whether source and available evidence permit a useful thorough review. Do not start expensive diagnostics yet.

If a consequential prerequisite is missing, scan the remaining changed areas for other substantial entry gaps before replying. Batch all known gaps into one actionable request. For each, explain the uncertainty, why it matters and the smallest observation that resolves it. Then stop with `review_depth: intake`; explicitly say thorough review is incomplete. Do not investigate deeply just to fill a checklist, and do not promise the next review cannot discover a new defect.

Missing workflow approval, pending CI, an absent recording, old local-validation revisions, or a reviewer environment limitation alone are not missing prerequisites. Code and representative checks may already establish the behavior. Use `needs-information` only when uncertainty prevents a meaningful judgment, `blocked` for a demonstrated consequential defect/attack, or `needs-maintainer-decision` for a genuine scope decision. An early stop cannot claim security PASS.

## Otherwise: investigate in this session

Continue directly with `review_depth: thorough`; there is no second completeness session or `continue` result. Inspect the diff, affected callers and relevant security boundaries. Use focused diagnostics for consequential uncertainties. Stop when evidence supports a recommendation, not exhaustive coverage.

Other reviewers, including maintainer agents, supply evidence. Inspect their concrete findings and reported checks; distinguish reports from your own execution. Corroboration is not a reason to redo an already-supported investigation, and LGTM is not proof. Technical approval is not a product-scope decision. Do not assume a failure is unrelated just because its file is unchanged: consider dependencies, shared state and changed behavior.

For each failing CI entry in `ci.json`, return `ci_assessment` with its exact key, `relevant`, `unrelated` or `uncertain`, and supporting evidence. Entries for a workflow and its failed job can share one explanation. Pending/missing/action-required CI is disclosed by the publisher but does not require an author task. A relevant failure blocks; an uncertain failure warrants focused investigation and blocks readiness if still materially unexplained. Only evidence-supported unrelated failures can accompany `ready`. Green CI establishes only what actually ran.

## Follow-ups and findings

Start with `changes.json`'s persistent findings and accumulated delta. Verify outstanding corrections and risks introduced by the delta; preserve unaffected conclusions without treating them as proof of current code.

Return `finding_updates` for every previously open finding and any new or reopened finding. Reuse its ID and exact concern; update evidence, resolution condition and status. Resolve only with supporting source or verification; withdraw only with an explanation correcting the original finding. Reopen only with new evidence. Allocate new IDs sequentially after the largest existing ID (`F1`, `F2`, ...); new findings start open. Do not omit an open finding or silently replace it with a differently worded one. Resolved history is retained by the controller even if omitted from updates.

Track consequential defects, essential evidence gaps and product decisions, not optional nits. Each finding needs an actionable resolution condition. For destructive transitions, inspect the relevant lifecycle (for example loading, restoration failure and cancellation) together to avoid predictable one-case-at-a-time rounds. Batch known substantive blockers; never invent speculative variants to expand the request.

Use `ready` only after thorough review, scoped security PASS, no open findings or blockers, and no unresolved relevant CI failure. It means no review blockers at the stated revision, not all CI green or permission to merge. Finish with [REPORT.md](REPORT.md).
