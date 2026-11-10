# Developing the curator

This file guides coding agents working on the curator. Runtime reviewers start at [prompts/REVIEW.md](prompts/REVIEW.md).

- Do not write tests or add a test suite. Validate changes with compilation, inspection and proportionate runtime checks.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before commits or PR work.
- Keep instructions lean: link to the relevant guidance instead of repeating it. Read only the documents needed for the task.
- Keep controller authority outside model output. Route GitHub mutations through the narrow publisher; fail closed on unknown author, freshness, model or tool provenance. CI is evidence, not a green-status gate; new adverse evidence must be assessed before publication.
- Never commit credentials, host configuration, transcripts or contributor artifacts.
- Deploy through [maintenance](docs/setup.md#maintenance-and-recovery), holding the sweep lock while leaving the timer active. Never stop the timer as a deployment step.

| Task | Start here |
| --- | --- |
| Review behavior, decisions or wording | [Runtime index](prompts/REVIEW.md), then the linked topic |
| Eligibility, recovery or publication | [POLICY.md](POLICY.md), `src/controller.ts`, `src/snapshot.ts`, `src/publisher.ts` |
| Evidence and tool boundaries | [Isolation](deploy/ISOLATION.md), `src/evidence.ts`, `reviewer/`, `src/guest.ts` |
| Deployment and operations | [Setup guide](docs/setup.md), `deploy/` |
