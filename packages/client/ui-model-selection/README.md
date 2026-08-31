# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Model selection plugin, browser half: TWO entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`). For ordinary sessions, the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's advisory directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance. The compact composer trigger opens a two-level Model/Effort menu: models stay provider-grouped, while the selected exact model supplies its adapter-owned effort names, descriptions, and default. `/model` applies the selected model's default effort, and the composer can then choose any advertised effort.

The Host-reported provider/model/reasoning `ModelSelection` is the single selection fact, but it is echoed only when the exact provider/model pair remains in the advertised groups; an absent catalog row leaves the routable selection intact while the trigger prompts `Select model`, no stale row is synthesized, and no Effort row is shown until the user picks an advertised model. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection before display. Provider-local metadata failures list inline while usable groups stay selectable, and selection failures retain the prior selection and directory.

When the Host reports that no adapter serves the session's route (`session.models.routable`), this plugin raises a composer block through `ctx.conversation.blocks` and the input goes inert with this plugin's own copy; recovering clears it without a reload. It follows `routable` and nothing else: a `null` — before the first load, or after one failed — never blocks, or a slow Host would lock a working composer, and catalog membership never blocks either, because a route serving a model it stopped advertising is missing from the groups yet perfectly usable. The trigger's own `Select model` fallback still covers that case, which is display, not a gate.

Directories are per-session, resolved lazily through `ctx.modelDirectories.directoryFor(sessionId)`, and disposed with the session scope. Addressed subagent sessions expose neither entry, and their directory rejects loads, selections, and reconnect refreshes, because ordinary Agent-bound model RPCs would activate persisted child history outside the direct-parent continuation path.

Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events. Provider topology, provider catalogs, and the default selection therefore converge without the Host or client runtime deriving a separate model-change alias.

A model row can carry advisory lines another plugin contributes. `ctx.modelDirectories.registerHints(source)` takes one source at a time — a second registration while one stands throws — and returns its disposer. The seat reads whichever source stands when it mounts and asks it exactly once, so a menu opened while that answer is in flight renders unannotated and takes the lines on its next mount. Each hint names a provider and a model and carries already-localized text: this package places the lines on the row with that exact pair, both on the shared hover/focus tooltip and in a description the row names through `aria-describedby`, and never reads or reformats them. A hint for a model the directory does not list annotates nothing, and a source that rejects leaves every row exactly as a composition with no source at all.

The `/client` exports are the plugin body (`apply`/`inject`), `ModelDirectoryResolver`, `ModelDirectory` with its state fields, the seat's injected face type, and the hint types a contributor writes against.

## Model Experience

Indirectly, through the `session.selectModel` RPC available to ordinary sessions, both entries submit the complete `ModelSelection` that the Host snapshots at the next prompt-assembly boundary, so the following request uses the selected provider, model, and effort while a running step keeps its assembled selection; the selection becomes durable only when the existing request header records a request that consumes it, and menu interaction adds no prompt content.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **A hint source is read once per mount, and only its lines are shown** — the seat never polls it, so a contributor whose answer changes reaches an open menu on the next mount; the tooltip renders the lines verbatim, so anything a reader needs about how they were derived belongs in the text the contributor produced.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.
