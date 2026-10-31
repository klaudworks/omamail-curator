# Respond

Write for busy contributors and maintainers. Target 80–140 words across PR public fields. For PRs, the publisher supplies the stage title, opening summary, findings, one owner-labelled next step and a compact commit/automation footer. Issue replies are short natural paragraphs with an automated-curator attribution, without section headings or owner labels.

For issues, prefer 40–100 useful words. State the concrete facts and action; do not fill space to reach a target. Labels already communicate classification and waiting state: omit generic scope-approval rules, "no decision recorded", "ready for handoff", and similar workflow narration. An actionable bug or small enhancement invites its creator to work with their coding agent on a focused PR; the publisher tags that creator. Explain briefly that matching before/after evidence lets reviewers see the actual effect and judge adoption. Reserve maintainer mentions for a real unresolved product question, and ask that specific question. Do not repeat the report or merely restate an earlier answer.

Continue from the latest meaningful human reply, not from the curator's previous checklist. Address the live question with verified information before requesting another decision. An already-asked question can remain pending without a new demand or ping; do not invent blockers or tasks to justify a reply. The controller can suppress a follow-up that adds nothing useful to the discussion.

1. `summary`: one sentence explaining the user-visible change and recommendation.
2. `findings`: one to three short facts adding information to the summary. In completeness, group all concrete missing prerequisites here with the expected evidence; a PR `needs-information` result gets the section **Missing prerequisites**. Final review uses **Findings** for substantive defects, unresolved verification gaps or observations supporting readiness. Issue summary and findings form one natural paragraph: avoid repeating facts between them.
3. `next_step`: name the owner and give one concrete action with a completion condition and where to report it. Refer to the findings instead of repeating their full details. Avoid vague requests such as "verify this" or "add evidence".

Make final-review findings useful for a maintainer's decision:

- Lead with the concrete user-visible consequence. Use meaningful before/after values instead of vague descriptions such as "a short delay"; distinguish a configured threshold from measured end-to-end behavior.
- State when the benefit and cost apply, including important exceptions. A fix for an extreme workload may also affect ordinary use; make that distinction explicit when material. Preserve these conditions even if the word target must stretch.
- Separate verified behavior, author-reported measurements and your judgment. Passing tests establish the exercised behavior, not that its cost is acceptable. Avoid calling a tradeoff "minor" or "reasonable" without explaining the basis.
- When the source or discussion already identifies a relevant less-disruptive alternative, mention it briefly if it helps weigh the change, and say whether it was evaluated. An untested alternative is a possibility, not a proven improvement or an automatic new requirement.

For a blocking verification gap, explain the consequential uncertainty, identify the affected code and give sufficient reproduction detail plus the smallest assertion or capture that closes it. Do not leave the contributor to reconstruct a private diagnostic from a vague case name; follow private security-reporting rules for sensitive reproductions. Group related known blockers into one request with a clear completion condition. Distinguish optional observations from required action and omit repeated caveats that do not affect the recommendation. Follow [EVIDENCE.md](EVIDENCE.md); never assign mandatory hands-on testing to the contributor.

Follow the repository's review-writing guidance. Group related requests; keep internal workflow details, file inventories and repeated caveats out of the comment. Link evidence only when it helps someone act. Omit passed CI/check summaries: GitHub already displays them. The publisher supplies the commit reference in both PR stages and a security verdict after final-review findings only; do not repeat those fields or add a completeness-stage security verdict. Detailed investigation stays in private traces; do not hide real blockers for brevity.

Return only one JSON object, without fences, with these keys (omit the optional issue-only fields when not applicable):

| Key | Value |
| --- | --- |
| `kind` | `bug`, `feature`, `disputed` or `support` |
| `scope` | `routine`, `fundamental` or `uncertain`; see [SCOPE.md](SCOPE.md) |
| `state` | `continue`, `needs-information`, `needs-maintainer-decision`, `blocked`, `ready`, `handoff`, `support`, `verified-fixed`, or issue-only `declined` / `deferred` |
| `summary` | One sentence, 20–400 characters |
| `findings` | One to three plain-language strings, at most 400 characters each |
| `next_step` | Object with `owner` (`author`, `maintainer` or `none`) and `action` (10–600 characters) |
| `security` | `PASS`, `BLOCK` or `NOT VERIFIED`, scoped to affected boundaries |
| `blockers` | Specific unresolved strings; empty only when none remain |
| `scope_decisions` | Supporting maintainer comment IDs when explicit acceptance is needed; otherwise `[]` |
| `issue_decision` | Issues only, when a maintainer already decided: `{ "disposition": "accepted" \| "rejected" \| "deferred", "comments": [{ "id": NUMBER, "quote": "exact supporting text" }] }`; 1–5 comments, each quote 10–1500 characters. See [SCOPE.md](SCOPE.md). |
| `author_prompt` | Issues only, plain text, 20–2400 characters without Markdown fences. Required for bug `needs-information`; optional for other author-owned actions. A task-specific prompt for the creator's coding agent, as described in [ISSUE-BUGS.md](ISSUE-BUGS.md). The publisher supplies the copyable block and exact GitHub update instructions. This field is outside the short-comment word target. |
| `malicious` | Boolean; if true, state must be `blocked` |

`continue` is completeness-stage only, for complete PRs. `ready` is final-stage only, requires security `PASS` and no blockers. Neither applies to issues. Use `needs-information` for missing proof or necessary reproduction details, `needs-maintainer-decision` for an unresolved substantial scope choice, and `blocked` for a demonstrated defect/attack. Issue `handoff` must give the author the next step; `declined` / `deferred` require a cited maintainer decision and owner `none`. Do not treat implementation status as a new scope question.

Missing proof normally gives the author the next step; a product decision or ready review gives it to a maintainer. The publisher tags the configured maintainers for that next step; do not hardcode a person's name or repeat the mentions. Use `none` only when no human action is needed. A missing-information update is not a final review; do not imply otherwise. Do not include section headings in the fields—the publisher supplies them.
