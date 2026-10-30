# UI evidence

Read the repository's applicable UI/interaction guidance. Check the changed behavior: discoverability, keyboard/focus, layout, theme/size and relevant empty/error/cancellation paths. Do not expand the review into unrelated screens or platforms.

Use attachment provenance to distinguish:

- Component fixtures: synthetic layout/interaction evidence.
- Hands-on host checks: real mouse, keyboard, focus and rendering behavior.
- Backend/provider checks: real external behavior, only when the change affects it.

Passing CI and offscreen tests do not establish required hands-on behavior. Conversely, a UI-only change does not inherently need a real mailbox. Ask for only the missing checks required for the affected path.

Videos are available as sampled frames, not full playback. Do not turn that reviewer limitation into a contributor task unless a required interaction is actually unsupported by the available evidence. Mention limitations only when they affect the conclusion or next action.
