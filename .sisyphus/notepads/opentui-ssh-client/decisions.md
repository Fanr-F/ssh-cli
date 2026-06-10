# Architectural Decisions

## 2026-06-10 — Terminal Panel UI (Task 13)

### Decision: TerminalPanelAPI with .component pattern
- **Context**: Task spec says `createTerminalPanel()` returns either `BoxRenderable` or `TerminalPanelAPI`.
- **Decision**: Return a `TerminalPanelAPI` object with all state management methods plus a `.component` property for the ProxiedVNode.
- **Rationale**: Clean separation between render tree integration (`.component`) and imperative state control (methods). The parent app adds `.component` to its tree and calls methods to change states.
- **Alternative considered**: Attach methods to the Box proxy via Object.assign — too hacky, TypeScript wouldn't allow it.

### Decision: Visibility toggling for state management
- **Context**: Panel has 5 visual states (idle/connecting/connected/error/disconnected).
- **Decision**: All state overlays live as children of the root container; visibility is toggled via `.visible` property.
- **Rationale**: Simple, leverages ProxiedVNode property delegation. Avoids complex add/remove child management.
- **Alternative considered**: Dynamically swap container children — more complex, harder to verify.

### Decision: Use onKeyDown for keyboard forwarding
- **Context**: Panel needs to capture keyboard input and forward to SSH.
- **Decision**: Use the `onKeyDown` option in `Box({...})` factory, calling `keyCallback(key.sequence)`.
- **Rationale**: Native OpenTUI keyboard handling pattern. No need for manual event listeners.
- **Alternative considered**: Listen on `renderer.keyInput` — would capture all keys, not just when panel is focused.

### Decision: Connected state leaves empty Box ready for TerminalRenderer
- **Context**: Connected state needs to display terminal output from TerminalRenderer.
- **Decision**: Connected state shows an empty Box. The app bridge (Task 15) will wire TerminalRenderer's `renderFull()` output as a child.
- **Rationale**: Separation of concerns — the panel manages state only; rendering the actual terminal content is the bridge's responsibility.
