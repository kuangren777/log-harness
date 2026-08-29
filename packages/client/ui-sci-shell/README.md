# @deepseek-ai/dsh-client-ui-sci-shell

English | [中文](README.zh.md)

The CaMeL Science workbench shell: the icon rail down the left edge, the two controls in its footer, the account popover, and the aurora backdrop. The rail occupies [ui-layout](../ui-layout/README.md)'s generic `rail` slot, so composing this package out of cordis.yml gives that track back its zero width and the three columns keep the whole frame. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Nothing here is view-specific machinery. The rail declares `rail.item` and `rail.footer` as ordinary root-scope list seats and hands both of them the frame's `{ view, showView }` pair, which is the same write `ctx.layout.showView` performs. A later view package therefore adds its button by registering one `rail.item` entry beside the research-flow button this package ships, and adds the view itself by registering the matching `view` key — neither touches this package. The button reads its own pressed state from that owner share rather than from the layout service, so what it draws and what it routes cannot drift apart.

The palette toggle reads the active colour scheme through an injected reader/subscriber pair built once in `apply` over `ctx.theme`, and writes the other concrete palette back. The identity is a plain, same-origin HTTP read: sci-gate reverse-proxies this page, so `/gate/api/me` and `/gate/api/credit/balance` answer from the session cookie and no credential ever reaches this code. Both reads live behind a total vocabulary in `gate-me.ts` — a rejected status, a body that is not an object, and an unreachable gate all arrive as `null` rather than as a throw at render time — and every id the gate reports is normalised to a string, because the popover matches the selected VM on its id and never on its slug.

The rail's avatar and the popover are two registrations sharing one store handle constructed in `apply`, which the framework resolves to a single root-scope instance: clicking the avatar is what the popover observes, and the popover's gate read is what fills the avatar's letter. The read happens once per mount rather than per open, because the avatar must not wait for the user to open anything. Every row the card shows is a fact the gate answered — the account email, its role and tenant, the selected VM's slug and image tag, and the balance with an exhausted marker — and a row the gate reported nothing for is not rendered at all. A gate that could not be read shows one line saying so and no numbers.

The overlay layer is click-through, so the popover opts back into pointer events only while it shows: a closed card intercepts nothing meant for the app underneath. It closes on `Escape` and on a click on its scrim, and signs out by posting `/gate/api/logout` and navigating to `/gate/login` only once the gate accepted the teardown. The aurora is `aria-hidden`, never takes pointer events, and carries `data-sci-motion` so ui-brand-sci's reduced-motion rule disarms its drift without reaching any other animation on the page; it registers at `order: -100`, far below every other overlay entry, because it is a backdrop.

`SciLogo` is the one symbol this package imports from [ui-brand-sci](../ui-brand-sci/README.md), and `CONVERSATION_VIEW` the one it imports from ui-layout; both rows are declared as `dsh.client.external` module-graph requests. The `/client` exports are the plugin body (`apply`/`inject`) alone — the components, the store factory, and the gate reads stay package-internal behind the slot registrations.

## Model Experience

None, as this is a browser-side shell whose Node half is an inert loader seat: it registers no tool, prompt section, or session event, and the only facts it shows come from the browser's own theme service and from the gate the page is already served through.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **An unreachable gate degrades the popover to one line.** A dsh page served without sci-gate in front of it (a local `dsh web`, a direct port) has no `/gate/api/*` to answer, so the card states that it is not signed in to the gate and shows no email, VM, or balance. The rail, the palette toggle, and the aurora are unaffected; this package deliberately renders no placeholder numbers in that state.
- **The identity is read once per mount, not kept live.** The gate publishes no change stream, so a VM re-selected or a balance spent in another tab is not reflected until the page reloads. Polling was rejected as a cost every session would pay forever for a card most users open rarely.
- **The balance is shown, not explained.** Only the combined total appears, with the gate's own `exhausted` flag beside it; the plan and credit pools it is made of, the subscription period, and top-up are the gate's own credit page, which this popover does not link to because the shell has no route vocabulary for gate pages yet.
- **Sign-out navigates away rather than tearing the session down in place.** The harness page is inside the gate's origin, so clearing the cookie invalidates the page it is running on; a full navigation to the login page is the only honest end state, and any unsent composer draft goes with it.
