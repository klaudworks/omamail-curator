# Controller policy

Reviewer decisions are documented once, under [prompts/REVIEW.md](prompts/REVIEW.md). Repository files supply product, engineering and evidence guidelines; curator guides supply workflow, scope escalation and output rules.

## Eligibility and execution

- Process eligible open items oldest first, sequentially every 5 minutes. Configured authors and explicitly enrolled `tracked_prs` are eligible; optionally include PRs by any author created at or after `all_pr_authors_since`. The cutoff uses creation time, not updates or reopening. Exclude draft PRs and deferred items.
- Before each PR model stage and publication, require both configured workflows and every job to succeed for the current head. Pending, missing, skipped, neutral, cancelled or failed results stop the item. Issues have no PR CI prerequisite.
- Use the configured completeness model and a fresh session for final review. Authentication, transport, tool or output failures pause work. Review-count and model-duration limits are not imposed.
- Completeness checks prerequisites without repository-wide execution; final review uses focused diagnostics. Neither stage executes or requires full repository suites. The existing current-head CI gate remains the baseline; additional evidence requests must identify a concrete unresolved scenario in changed behavior.
- Repository content never configures the runtime. Only installed reviewer guides are instruction sources. Native OpenCode tools use a credential-free Bubblewrap workspace with no external network or model-service process access. Each stage shares disposable diagnostic copies; evidence and generated outputs are read-only. GitHub credentials and checkpoint keys remain on the controller host, outside the VM; model authentication remains in the trusted SDK host, outside tool processes. See [Isolation](deploy/ISOLATION.md).

## Publication and recovery

- Publish only one identified status comment, informational `COMMENT` reviews, and `needs-information`, `needs-maintainer-decision` or `review-ready` labels. Never close/reopen, approve, request changes, merge, alter draft state or repair contributions.
- Validate output, selected-model sessions and required guide/evidence reads. Recheck creator, current head/base, CI and relevant discussion before each effect. Readiness requires a fresh final review, verified affected security boundaries and no blockers.
- Keep signed checkpoints in status comments. Unchanged inputs reuse the assessment; changed inputs first receive a relevant-delta reassessment. Policy-version changes invalidate old assessments once. Deleting a status comment triggers fresh processing when eligibility passes.
- Discover existing comments/reviews before retrying a write. Exclude signed automated events from human decisions. Immediately recheck after publication; remove stale readiness if inputs changed. GitHub cannot make the check and mutation atomic.
- Review proposed criteria changes against the baseline guidance. Duplicate handling is deferred. Maintainers own disposition.
