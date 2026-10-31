# Incremental review decisions

The controller checks eligibility and current-head CI first. Unchanged inputs need no model. Initial assessments always run; a verified unchanged public checkpoint can establish a private baseline without another review.

With `decision_token_file` configured, changed inputs are compared with the **last full assessment**, never just the last skipped update. Jev receives the previous assessment, complete baseline discussion, accumulated additions/edits/removals, current title/description, author/maintainer identities, and PR source deltas. Inline-review context includes filenames, lines and diff hunks. Repeated unchanged discussion is represented once.

## Routing

- Use `jev-1.14.0` at the official TypeSafe `/v1/systemone` endpoint. A normal update may skip only when `P(needs_review) <= 0.1`.
- New or removed linked evidence goes to the full reviewer, including screenshots/videos. Jev never assumes it has inspected a URL's contents. Experimental image support is not used.
- Behavioral contributor edits, binary changes and incomplete source collection go to review. Nonfunctional documentation is eligible for a decision, not automatically skipped.
- For branch-sync merges, independently reproduce the two-parent merge using its merge base, confirm the other parent belongs to the target branch, and compare the computed tree with the actual commit. Extra edits and conflict-resolution changes fail this check. Supply incoming upstream changes and the full current contribution diff so Jev can judge interactions.
- Only a verified branch-sync with unchanged title, description and discussion uses the merge-specific question and threshold `P(needs_review) <= 0.2`. A clean Git merge alone is insufficient. Existing unresolved findings remain in force.
- These probabilities are decision thresholds, not demonstrated error rates. Material and uncertain updates proceed to review. API/network/output failures wait for another cheap decision attempt instead of triggering expensive reviews.

The transport body is capped at 96,000 UTF-8 bytes; the API's default 32k-per-question/64k-per-request token limits remain authoritative. Bytes are not treated as exact token counts. A local size rejection or API context-limit rejection goes to full review, with no truncation and no automatic 262k long-context opt-in.

## State and publication

Private baselines and decisions live under `state_dir/relevance/`, anchored to the current signed public status comment. Cache each successful skip by the baseline/current fingerprints, model and question versions, so repeated polling makes zero model calls. Removing or changing the signed anchor invalidates the baseline. Skipping never advances the reviewed source SHA, marks a new commit reviewed, or grants readiness; new head/base changes remove stale `review-ready`.

Save completed assessments before publication so a failed comment/label request can reuse model work. Discover signed comments before retrying writes. Initial issue triage always posts one comment; issue follow-ups can remain silent when the answer is redundant with the latest public assessment. The controller conservatively publishes on a changed category/state/owner/disposition or uncertain redundancy. PR assessments retain one-comment-per-assessment history.

## Initial evaluation

A small historical discussion replay used ten examples during prompt refinement and six held-out examples. The selected question skipped all eight nonmaterial updates and retained all eight substantive ones. A read-only replay of the image-downscaling branch sync verified its exact merge tree, skipped the independent upstream change, preserved the previously reviewed SHA, and made zero calls on the repeated decision. Synthetic merge contrasts covered unrelated documentation and an interacting image-limit change. These checks establish basic fit, not a statistically measured miss rate; inspect saved decisions when assessing later performance or changing thresholds.
