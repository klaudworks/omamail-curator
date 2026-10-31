# Respond

Write for busy contributors and maintainers. Target 80–140 words across the public fields. The publisher supplies the stage title, opening summary, findings, one owner-labelled next step and a compact commit/automation footer.

1. `summary`: one sentence explaining the user-visible change and recommendation.
2. `findings`: one to three short facts. In completeness, group all concrete missing prerequisites here with the expected evidence; a `needs-information` result gets the section **Missing prerequisites**. Final review uses **Findings** for substantive defects, unresolved verification gaps or observations supporting readiness.
3. `next_step`: name the owner and give one concrete action with a completion condition and where to report it. Refer to the findings instead of repeating their full details. Avoid vague requests such as "verify this" or "add evidence".

Make final-review findings useful for a maintainer's decision:

- Lead with the concrete user-visible consequence. Use meaningful before/after values instead of vague descriptions such as "a short delay"; distinguish a configured threshold from measured end-to-end behavior.
- State when the benefit and cost apply, including important exceptions. A fix for an extreme workload may also affect ordinary use; make that distinction explicit when material. Preserve these conditions even if the word target must stretch.
- Separate verified behavior, author-reported measurements and your judgment. Passing tests establish the exercised behavior, not that its cost is acceptable. Avoid calling a tradeoff "minor" or "reasonable" without explaining the basis.
- When the source or discussion already identifies a relevant less-disruptive alternative, mention it briefly if it helps weigh the change, and say whether it was evaluated. An untested alternative is a possibility, not a proven improvement or an automatic new requirement.

For a verification gap, state the scenario and expected assertion or capture so the contributor's agent can implement it. Follow [EVIDENCE.md](EVIDENCE.md); never assign mandatory hands-on testing to the contributor.

Follow the repository's review-writing guidance. Group related requests; keep internal workflow details, file inventories and repeated caveats out of the comment. Link evidence only when it helps someone act. Omit passed CI/check summaries: GitHub already displays them. The publisher supplies the commit reference in both PR stages and a security verdict after final-review findings only; do not repeat those fields or add a completeness-stage security verdict. Detailed investigation stays in private traces; do not hide real blockers for brevity.

Return only one JSON object, without fences, with exactly these keys:

| Key | Value |
| --- | --- |
| `kind` | `bug`, `feature`, `disputed` or `support` |
| `scope` | `routine`, `fundamental` or `uncertain`; see [SCOPE.md](SCOPE.md) |
| `state` | `continue`, `needs-information`, `needs-maintainer-decision`, `blocked`, `ready`, `handoff`, `support` or `verified-fixed` |
| `summary` | One sentence, 20–400 characters |
| `findings` | One to three plain-language strings, at most 400 characters each |
| `next_step` | Object with `owner` (`author`, `maintainer` or `none`) and `action` (10–600 characters) |
| `security` | `PASS`, `BLOCK` or `NOT VERIFIED`, scoped to affected boundaries |
| `blockers` | Specific unresolved strings; empty only when none remain |
| `scope_decisions` | Supporting maintainer comment IDs when explicit acceptance is needed; otherwise `[]` |
| `malicious` | Boolean; if true, state must be `blocked` |

`continue` is completeness-stage only, for complete PRs. `ready` is final-stage only, requires security `PASS` and no blockers. Neither applies to issues. Use `needs-information` for missing proof, `needs-maintainer-decision` for a fundamental direction decision or explicit objection, and `blocked` for a demonstrated defect/attack.

Missing proof normally gives the author the next step; a product decision or ready review gives it to a maintainer. The publisher tags the configured maintainers for that next step; do not hardcode a person's name or repeat the mentions. Use `none` only when no human action is needed. A missing-information update is not a final review; do not imply otherwise. Do not include section headings in the fields—the publisher supplies them.
