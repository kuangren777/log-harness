# dsh-client-ui-settings-skills

English | [中文](README.zh.md)

The **Skills** settings section: every skill the current session's project discovers, grouped by where it came from, with the two invocation surfaces a user may override per skill. This is the policy editor over `skill.inventory` and the `skills` settings namespace — not the Cordis Loader listing, which the **Plugins** section owns.

## What appears here

Skill discovery is scoped to a session's working directory, so the page is addressed by the current session and says which directory it read. Without a current session there is nothing to address, and the page says that instead of listing a stale project.

Groups arrive nearest-first: the scope's own chain before the host-wide layer, better rank before worse. Each group is titled by its origin — the project and user `.dsh` / `.agents` / `.claude` roots, a configured directory, the deployment's bundled skills, and runtime contributions — and shows the directory it was discovered in, with a POSIX home abbreviated to `~`. The origin vocabulary is the Host's and stays open, so a value this package does not recognize renders raw rather than as a wrong label.

Every discovered contribution appears, including the losers a nearer definition already shadowed. A shadowed row is read-only: an override on it would address a name someone else claimed. A partial answer — a provider that failed, or a catalog that moved mid-discovery — says so inline rather than presenting itself as the whole list.

## Writes

Each row carries two switches, **Model** and **User**, showing the effective policy the Host resolved. Flipping one stores that surface as an override for the skill name and keeps the other surface exactly as it stood, because both share a single stored entry. A row with a stored override is marked and offers a reset that clears the entry, restoring whatever the skill itself declared.

Writes go through the client settings scope for the `skills` namespace, which fences each one with the revision it read. Nothing is shown optimistically: the page re-reads the inventory once the write settles, so a row always displays what the Host resolved. It also re-reads on the forwarded `skills/change` invalidation and on a connection reset, and it re-addresses itself when the current session moves. A deployment whose settings document is read-only, or that does not serve the `skills` namespace, disables every control and says why.

## Model Experience

Indirectly, through the skill registry: this section only stores invocation overrides, and the registry and `dsh-tool-skill` own the model-facing catalog and the rendered body a skill produces.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One override entry per name, not per contribution** — the stored section is keyed by skill name because layer merging already resolves one winner per name, so a project copy and a user copy of the same skill cannot be governed separately; the override follows whichever contribution currently wins.
- **The scope is the session's, not the panel's** — Settings is a root surface with no session of its own, so the page follows the current session's working directory. Reading another project's skills means opening a session there first.
- **No search or bulk action** — a deployment with many discovered skills gets one long list; filtering, and turning a whole origin off at once, are deferred until the shape of real inventories is known.
- **A rejected write surfaces only as an unchanged row** — the scope reloads Host state for a write it could not land, so the switch returns to its stored position without naming the reason; the page reports read failures but not write ones.
