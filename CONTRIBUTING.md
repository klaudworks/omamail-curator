# Contributing

Use Python 3.11+ and the standard library. Run `python3 -m unittest discover -s tests -v` and `python3 -m compileall -q curator` before committing. Test eligibility, publication authority and recovery with fake endpoints before live GitHub use. Do not point integration tests at a repository without its operator's authorization.

Read `AGENTS.md` and `POLICY.md`. Keep changes focused. Public documentation must not contain private hostnames, usernames, credential paths or authentication material. Runtime configuration and logs live outside this checkout. Never claim a passing model exit code proves success: validate events and typed output.
