# Developing the curator

This file guides coding agents working on the curator. Runtime reviewers start at [prompts/REVIEW.md](prompts/REVIEW.md).

- Do not write tests or add a test suite. Validate changes with compilation, inspection and proportionate runtime checks.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before commits or PR work.
- Keep instructions lean: link to the relevant guidance instead of repeating it. Read only the documents needed for the task.
- Keep controller authority outside model output. Route GitHub mutations through the narrow publisher; fail closed on unknown author, CI, freshness, model or tool state.
- Never commit credentials, host configuration, transcripts or contributor artifacts.

| Task | Start here |
| --- | --- |
| Review behavior, decisions or wording | [Runtime index](prompts/REVIEW.md), then the linked topic |
| Eligibility, recovery or publication | [POLICY.md](POLICY.md), `curator/controller.py`, `curator/snapshot.py`, `curator/publisher.py` |
| Evidence and tool boundaries | `curator/evidence.py`, `curator/evidence_tools.py`, `curator/guest.py` |
| Deployment and operations | [README.md](README.md), `deploy/` |
