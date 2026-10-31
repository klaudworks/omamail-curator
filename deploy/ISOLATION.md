# Reviewer isolation

The controller holds GitHub credentials and checkpoint keys outside the VM. It sends only public evidence. The trusted Bun/OpenCode SDK host runs inside the existing VM and handles subscription authentication; it opens no HTTP listener. Only tool processes enter Bubblewrap.

## Native workspace backend

OpenCode V2.2.1's `WorkspaceDriver` supplies an `EnvironmentDriver.spawner`. Native file/image/PDF reads, grep/glob, patch/edit/write and shell delegate to it, using OpenCode's existing process-backed filesystem implementation. `reviewer/workspace.ts` changes the process launch, not each tool's implementation. One disposable workspace is shared across a review stage. Each subprocess gets fresh mount, PID, user and network namespaces under the same policy; there is no nested diagnostic sandbox or evidence MCP server.

The sandbox exposes read-only public system/toolchain files, read-only submitted evidence, writable diagnostic copies and read-only generated output directories. It has an empty home, isolated `/proc`, no network, no capabilities, `NoNewPrivs`, and disabled nested user namespaces. Process launches use an empty host environment, explicit stdio pipes and no additional inherited descriptors. Only public locale/terminal variables are forwarded. Native foreground/background execution, timeout escalation and scope cleanup remain OpenCode's responsibility; Bubblewrap's PID namespace and parent-death handling cover descendants.

## Host-side paths

- Configuration, plugins, skills and instructions are not discovered from user, system or repository directories. The host installs its configuration and one allowlisted `curator_guide` tool in memory. Repository guidance remains evidence.
- Automatic formatting, LSP, file watching, snapshots and filesystem indexing are disabled. In particular, V2.2.1 formatters otherwise execute through host-side `AppProcess`.
- V2.2.1 native `read` still uses host `FSUtil` for missing-file suggestions and nested `AGENTS.md` discovery. A before-execution hook restricts reads to a unique virtual workspace prefix that must not exist on the host, or the assigned generated-output directories. This contains those auxiliary paths without replacing native read. Other sandbox paths can be examined through shell.
- Shell and truncated-output persistence stay host-side in per-stage directories. Only those directories are mounted back read-only, so reviewer code cannot replace output files with host-targeting symlinks. The database, transcripts, configuration and authentication files are never mounted.
- Tool permissions default to deny. The model context exposes only the native investigation tools plus `curator_guide`; an execution hook also rejects every other tool. Missing required tools abort dispatch. No subagents, MCP, browser, network or publication tools are exposed.
- Both stages validate the selected model, normal completion, required guide/evidence reads and tool failures. Fresh final-review sessions and signed checkpoint/publication gates remain controller-owned.
- SDK startup session recovery is disabled: each invocation owns one fresh stage, never orphaned claims from another invocation. Workspace bindings are checked against the stage identity. Interrupt signals abort the owning Effect scope and clean up its disposable workspace.

## Verification and limits

Operator probes are disposable, not a committed test suite. Run them on the deployment VM after dependency, SDK or sandbox changes: text/image/PDF reads; search; write/edit/patch; read-only evidence; direct/symlink/parent-root access; cleared environment and a deliberately inheritable synthetic descriptor; local API/proxy and external-network denial; timeout, background notification, output-file reads and descendant cancellation. Exercise real model tool dispatch as well as direct native executors. Never use actual credentials as probe contents.

This is a Linux OS boundary, not a permissions-only restriction. Bubblewrap shares the VM kernel and does not protect against kernel vulnerabilities, all denial-of-service attacks, or a compromised trusted SDK/runtime. Passing the listed probes demonstrates those specific controls, not a comprehensive security proof. Upgrading the pinned SDK requires repeating the host-path audit.

Research and exact-version audit: [NATIVE-TOOLS.md](NATIVE-TOOLS.md).
