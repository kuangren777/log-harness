# @deepseek-ai/dsh-client-ui-brand-sci

English | [中文](README.zh.md)

CaMeL Science presentation for the `sci` profile's Web client. The package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the CaMeL Science mark (a rounded conic-gradient tile) and wordmark, stacks one alias-token layer over the `--dsw-*` base palette through `ctx.theme.overrideTokens`, and mounts a plugin-owned sheet that redefines the motion curve, durations, and font stack the upstream sheets already read. The profile disables `ui-brand-official` and inserts this row in its place; both rows occupy the same `single` slots, so they never coexist.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls, exactly like the official package: the row works whether it activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The token layer supplies both palette modes for every name (near-black grounds with hairline borders in dark, an off-white ground with white surfaces in light, monochrome primary buttons, iOS semantic state colours), so a scheme switch never leaves an override illegible. Disposing the row restores the shipped brand, the base palette, and the upstream motion curve together. The package retains no runtime state; the node half is an empty Loader seat.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Colour only, not geometry** — the token layer changes palette; component radii and spacing stay with each UI package's own stylesheet.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.
- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
