# Respond

Write for busy people. Prefer 80–140 words for PRs and 40–100 for issues; exceed that when needed to batch all substantial gaps. The publisher supplies PR headings, owner mentions, commit reference, CI observation and security verdict (or an early-stop notice). Issues render as natural paragraphs. Do not duplicate that formatting or internal workflow narration.

Continue from the latest meaningful human reply. Answer factual questions before asking for decisions. Do not repeat an existing request, caveat or approval demand just to acknowledge new activity. The controller may suppress redundant issue replies.

## Public fields

- `summary`: the user-visible change or useful answer, and recommendation.
- `findings`: concise facts that add to the summary; normally one to three, more to cover all substantial blockers together. Explain consequential defects or evidence gaps; for readiness, identify the substantive basis and relevant tradeoff. Distinguish measured facts, author reports and judgment. Reference tracked finding IDs for actionable PR blockers and fixes. Explain any CI failure judged unrelated, with its supporting evidence.
- `next_step`: one owner and concrete action with a completion condition. Refer to findings instead of repeating them. Omit optional chores that would not affect the decision.

For a verification blocker, state the consequential uncertainty, why existing evidence is insufficient, and the smallest observation that resolves it. Include enough reproduction detail to act without reconstructing private diagnostics; keep sensitive security reproductions private. Batch known related blockers. Apply [EVIDENCE.md](EVIDENCE.md), including its override of blanket artifact requirements.

Mention a less-disruptive alternative only when it is already supported by source/discussion and helps the decision; say whether it was evaluated. Keep investigation logs, file inventories and immaterial caveats out of the public comment. Do not hide a real blocker for brevity.

## Output

Return one JSON object without fences. Omit optional issue-only fields when inapplicable; do not put headings in field values.

| Key | Value |
| --- | --- |
| `kind` | `bug`, `feature`, `disputed` or `support` |
| `scope` | `routine`, `fundamental` or `uncertain`; [SCOPE.md](SCOPE.md) |
| `state` | `needs-information`, `needs-maintainer-decision`, `blocked`, `ready`, `handoff`, `support`, `verified-fixed`, or issue-only `declined` / `deferred` |
| `summary` | One sentence, 20–400 characters |
| `findings` | Strings of 1–800 characters, normally one to three; include every consequential request rather than serializing them across rounds |
| `next_step` | `{ "owner": "author" \| "maintainer" \| "none", "action": "10–600 characters" }` |
| `security` | `PASS`, `BLOCK` or `NOT VERIFIED` for affected boundaries |
| `blockers` | Specific unresolved blockers; `[]` when none remain |
| `scope_decisions` | Supporting PR maintainer comment IDs when acceptance is needed; otherwise `[]` |
| `issue_decision` | Optional, issues only: `{ "disposition": "accepted" \| "rejected" \| "deferred", "comments": [{ "id": NUMBER, "quote": "exact supporting text" }] }`; 1–5 comments, quotes 10–1500 characters |
| `author_prompt` | Issues only: 20–2400 plain-text characters without fences. Required for bug `needs-information`; optional for other author-owned actions. Follow [ISSUE-BUGS.md](ISSUE-BUGS.md). Outside the comment word target. |
| `malicious` | Boolean; an actual attack requires `true` and state `blocked` |
| `review_depth` | Required for PRs only: `intake` for an early stop, otherwise `thorough` |
| `finding_updates` | Required for PRs only: array of `{ "id": "F1", "status": "open" \| "resolved" \| "withdrawn", "concern": "10–600 characters", "resolution": "10–800 characters", "evidence": "10–1200 characters" }`. See [PRS.md](PRS.md). Use `[]` when there are no findings to update. |
| `ci_assessment` | Required for PRs only: one `{ "key": "exact failing entry key", "relevance": "relevant" \| "unrelated" \| "uncertain", "evidence": "20–1200 characters explaining the judgment" }` for each failure/error/timed_out/startup_failure/stale entry in `ci.json`; `[]` when none exist. |

`ready` requires thorough PR review, security PASS and no open findings or blockers, including unexplained material CI failures. It does not assert green CI or authorize merging. Early stops use security NOT VERIFIED (or BLOCK for a demonstrated security defect). Use `needs-information` for consequential missing proof, `blocked` for demonstrated defects/attacks, and `needs-maintainer-decision` for unresolved substantial product choices. Never return `continue`. Do not turn implementation status into a scope question.

Missing information normally belongs to the author; a ready PR or product choice belongs to a maintainer. Issue `handoff` invites the author to prepare a focused PR. `declined` / `deferred` require a cited maintainer decision and owner `none`. Use `none` only when no human action is needed. Do not hardcode maintainer names; the publisher tags the configured people.
