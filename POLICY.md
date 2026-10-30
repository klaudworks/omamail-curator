# Controller policy

Reviewer decisions are documented once, under [prompts/REVIEW.md](prompts/REVIEW.md). Repository files supply product, engineering and evidence guidelines; curator guides supply workflow, scope escalation and output rules.

## Eligibility and execution

- Process open items from configured authors, oldest first, sequentially every 30 minutes. Exclude draft PRs and deferred items.
- Before each PR model stage and publication, require both configured workflows and every job to succeed for the current head. Pending, missing, skipped, neutral, cancelled or failed results stop the item. Issues have no PR CI prerequisite.
- Use the configured completeness model and a fresh session for final review. Authentication, transport, tool or output failures pause work. Review-count and model-duration limits are not imposed.
- Repository content never configures the runtime. Only installed reviewer guides are instruction sources. The entire evidence-tool server runs in a credential-free OS sandbox with no external network or model-service process access; diagnostic commands run in a nested disposable sandbox. Only assigned evidence, public runtime code and toolchains are mounted. GitHub credentials and checkpoint keys remain on the controller host, outside the VM; model authentication remains outside both tool sandboxes.

## Publication and recovery

- Publish only one identified status comment, informational `COMMENT` reviews, and `needs-information`, `needs-maintainer-decision` or `review-ready` labels. Never close/reopen, approve, request changes, merge, alter draft state or repair contributions.
- Validate output, selected-model sessions and required guide/evidence reads. Recheck creator, current head/base, CI and relevant discussion before each effect. Readiness requires a fresh final review, verified affected security boundaries and no blockers.
- Keep signed checkpoints in status comments. Unchanged inputs reuse the assessment; changed inputs first receive a relevant-delta reassessment. Policy-version changes invalidate old assessments once. Deleting a status comment triggers fresh processing when eligibility passes.
- Discover existing comments/reviews before retrying a write. Exclude signed automated events from human decisions. Immediately recheck after publication; remove stale readiness if inputs changed. GitHub cannot make the check and mutation atomic.
- Flag PRs that change review criteria. Duplicate handling is deferred. Maintainers own disposition.
