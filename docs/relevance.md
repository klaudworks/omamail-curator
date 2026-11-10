# Incremental review decisions

PRs use one review session: scan essential inputs and investigate if assessable. Issues retain triage. CI is evidence, not a successful-run gate.

## Routing

With `decision_token_file` configured, pinned `jev-1.14.0` compares accumulated changes with the **last full assessment**, never the last skipped update. Skip only when `P(can_skip) > 0.75`; exactly 0.75 reviews. This is a routing threshold, not measured accuracy.

The decider and reviewer share `changes.json`: assessed source/discussion, additions/edits/removals, persistent findings and next action. Lossless references avoid repeating unchanged fields; discussion is never truncated. Before/current CI is supplied separately to the decider. Corroboration can leave an assessment intact; contradictions, resolved blockers and changed maintainer decisions warrant reassessment.

- Initial assessments and missing private baselines review.
- Behavioral code changes, binary changes, unavailable source comparisons and changed evidence links require review. The decider never assumes a linked asset was inspected.
- New adverse CI evidence forces review. Missing/pending/action-required CI does not block it. CI progress may be nonmaterial, but success resolving an outstanding concern merits reconsideration.
- Identical head/base revisions need no Git fetch. Verified branch-sync skips require independently reproducing the merge tree and checking interactions; a clean merge alone is insufficient.
- There is no completeness-reuse decision or milestone. Each needed PR assessment resumes findings, checks essential inputs briefly and proceeds as far as useful.
- Decision API failures retry later. Oversized complete context routes to review without truncation or experimental context extension. The transport limit is 96,000 bytes; API token limits remain authoritative.

## State and publication

Finding records (`F1`, `F2`, ...) retain original/latest assessed revisions, resolution conditions and evidence. Open findings must appear in follow-up updates; resolved history is carried forward. The controller validates identity, transitions and absence of open findings before readiness. Historical reports remain context, not current proof.

Private baselines, decisions and pending publication live under `state_dir/relevance/`, anchored to the latest signed checkpoint. Findings live in both completed records and signed checkpoints, not another database. Skips never advance the full-assessment basis or grant readiness on new head/base revisions. Removing/editing the anchor invalidates private reuse.

PR contract 13 reconsiders old two-stage assessments once. Issue contract 14 and issue-follow-up suppression stay compatible. Legacy completeness files are no longer read; preserve them for rollback.

Persist model output before publication. Reconcile identical source/author/title/description with unchanged or harmless appended discussion and no new adverse CI evidence. Edits, deletions and changed links require review. Appended discussion needs `can_skip > 0.75`; plain CI progress needs no model to salvage completed work. Retain original assessed CI/fingerprint in the signed receipt. Missing private context for a discussion-reconciled receipt triggers review rather than inventing a baseline.

Publish one normal PR comment per completed assessment, deduplicating retries by assessment/session identity. Issue follow-ups may omit redundant comments at the same threshold; category/state/owner/disposition changes publish directly. Progress is a separate update-in-place signed comment. Report CI separately; early stops explicitly say thorough review is incomplete.

Before and after effects, recheck source/discussion and adverse CI changes. New failures during publication revoke readiness. GitHub cannot atomically combine reads and writes. Quota/backoff and authentication boundaries remain unchanged.
