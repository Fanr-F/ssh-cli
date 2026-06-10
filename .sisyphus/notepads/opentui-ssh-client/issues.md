# Issues

## 2026-06-10 — Terminal Panel (Task 13)

### StyledText type quirk with ProxiedVNode
- **Problem**: Setting `textProxy.content = 'plain string'` gives TS error: `Type 'string' is not assignable to type 'StyledText'`.
- **Root Cause**: ProxiedVNode uses `InstanceType` mapped type which picks the getter return type (`StyledText`) instead of the setter parameter type (`StyledText | string`).
- **Workaround**: Use `stringToStyledText(str)` from `@opentui/core` to wrap plain strings before assignment.
- **Potential Fix**: Could cast through `any` but `stringToStyledText` is cleaner and more explicit.
