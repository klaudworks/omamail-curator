# Reviewer isolation

The curator uses three boundaries:

1. **Controller host:** holds GitHub credentials, private configuration and checkpoint keys. It passes public contribution evidence to the VM; credentials and host directories are not shared with the VM.
2. **OpenCode VM:** the trusted model service handles model authentication. Agent permissions deny all tools except the curator's four evidence tools. Repository content cannot configure the service or add tools.
3. **Evidence-tool sandbox:** the entire MCP server runs in Bubblewrap with its own mount, process and network namespaces, an empty home and a cleared environment. It sees only assigned evidence, installed curator Python/guides, public system files and provisioned toolchains. Neither the service's authentication files nor its API socket is accessible here.

Diagnostic code runs in a second, disposable Bubblewrap sandbox inside the tool sandbox. It receives a writable source copy plus read-only submitted/baseline snapshots. Read/search tools also enforce evidence-root containment; installed guidance has a separate page allowlist. A missing optional evidence file is a normal lookup result, while an attempted path escape remains an error.

Keep credentials outside every mounted directory. Never pass them through tool environment variables, arguments, inherited file descriptors or evidence. A permission rule alone cannot prevent Python or shell code from reading a file available to that process; the OS boundary is what removes access.

## Deployment verification

Use synthetic sentinel files and environment values, never real credential contents. Verify that public evidence and nested diagnostics work, direct and symlink-based protected reads fail, parent process roots and descriptors cannot expose the sentinel, inherited environment values are absent, and the tool process cannot connect to the model-service API or an external network. Check these properties in the deployed VM as well as locally. Missing sandbox support must stop tool startup rather than fall back to unsandboxed execution.
