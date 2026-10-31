# Native-tool integration research — 2026-10-31

The selected implementation embeds **OpenCode V2.2.1** with its Effect SDK and runs it with **Bun 1.4.3**. These versions are locked. It does not use LiteLLM or a credential relay.

## Findings

Exa research identified the upstream [workspace-provider extension request](https://github.com/anomalyco/opencode/issues/45612). Providers can be supplied to the embedded Effect host; they are not a normal plugin/configuration switch. The [SDK](https://opencode.ai/v2/docs/build/sdk/) and [Effect SDK](https://opencode.ai/v2/docs/build/sdk/effect/) document embedding, scope ownership and plugins. The exact `workspaceProviders` interface was verified in the published 2.2.1 package declarations and executable source.

The relevant source path is:

1. `WorkspaceDriver.connect` returns `EnvironmentDriver.Driver`.
2. A location with `workspaceID` binds to that driver, with no local-driver fallback on connection failure.
3. `environment/environment` builds files from `execDefaults(driver.spawner)` plus optional overrides. Existing defaults implement read, stat, list, write, move, remove and mkdir.
4. Native read/media, grep/glob/ripgrep, edit/write/patch and shell use environment files/processes. Native shell provides streaming, background jobs, timeout handling and cancellation.
5. Host-side read suggestions/instruction discovery, formatter execution and output storage required the additional containment described in [ISOLATION.md](ISOLATION.md). A shell hook alone would not cover these paths.

Alternatives checked included [OpenCode Manager's shell delegation](https://github.com/chriswritescode-dev/opencode-manager/blob/af37ac3a8b6d49ca57130f64cb7d5d55883a2207/backend/src/services/opencode-sandbox-plugin.ts#L368-L423), [opencode-sandbox](https://github.com/betalyra/opencode-sandbox), and [Docker's contributed kit](https://github.com/docker/sbx-kits-contrib/tree/main/opencode). Their inspected versions did not provide this combination of native filesystem coverage, working background execution and no credential proxy. They were useful implementation references, not suitable drop-in dependencies.

[Bubblewrap upstream](https://github.com/containers/bubblewrap) provides namespaces and mount construction, not a complete policy. The implementation explicitly supplies the mounts, environment/descriptor rules, capability restrictions and lifecycle integration. The outer VM remains part of the boundary.
