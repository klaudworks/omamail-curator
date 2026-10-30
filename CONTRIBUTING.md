# Contributing

Use Python 3.11+ and the standard library. Do not write tests or add a test suite. Before committing, run `python3 -m compileall -q curator deploy` and `git diff --check`, inspect the affected boundaries, and perform proportionate runtime checks. Live GitHub effects require operator authorization.

Start at [AGENTS.md](AGENTS.md) and follow its task index. Keep changes focused. Public documentation must not contain private hostnames, usernames, credential paths or authentication material. Runtime configuration and logs live outside this checkout. A passing process exit code is not enough: validate events and typed output.
