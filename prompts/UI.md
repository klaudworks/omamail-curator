# UI evidence

Read the repository's applicable UI/interaction guidance. Check the changed behavior: discoverability, keyboard/focus, layout, theme/size and relevant empty/error/cancellation paths. Do not expand the review into unrelated screens or platforms.

Use attachment provenance to distinguish:

- Component fixtures: synthetic layout/interaction evidence.
- Automated host checks: integrated mouse, keyboard, focus and rendering behavior.
- Backend/provider checks: real external behavior, only when the change affects it.

Apply [EVIDENCE.md](EVIDENCE.md)'s verification policy. Automated interaction tests and synthetic captures of production components are valid evidence for the behavior they exercise. Identify a concrete uncovered interaction or visual state before requesting additional automated coverage. Component provenance alone is not a blocker, and a UI-only change does not inherently need a real mailbox.

Videos are available as sampled frames, not full playback. Do not turn that reviewer limitation into a contributor task unless a required interaction is actually unsupported by the available evidence. Mention limitations only when they affect the conclusion or next action.
