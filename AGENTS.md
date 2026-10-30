# Working agreements

Read `CONTRIBUTING.md` before commits or PR work. The runtime policy is `POLICY.md`.

Keep controller authority outside model output. All GitHub mutations must go through the narrow publisher. Fail closed on unknown author, CI, freshness, model or tool state. Tests must assert forbidden effects did not happen. Never commit credentials, host configuration, review transcripts or downloaded contributor artifacts.
