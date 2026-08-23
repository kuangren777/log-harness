# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |
| `dsh auth bootstrap --email <address>` | Create the deployment's first administrator account in the harness home's `auth.db`. |

The invoking directory is the default workspace root. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## First administrator

`dsh auth bootstrap --email <address>` makes one account the deployment's first administrator in `<harness home>/auth.db`; `--home <path>` overrides `$DSH_HOME`, which otherwise falls back to `~/.dsh`.

The subcommand is deliberately local-only. It opens the database directly, boots no profile, and is exposed on no network surface, so write access to the harness home is what authorizes it — the one right an operator has and a remote caller does not. It refuses with a nonzero exit as soon as any administrator exists, which keeps it from ever being an escalation path.

The password comes from `DSH_BOOTSTRAP_PASSWORD` whenever that variable is defined, and otherwise from a terminal prompt that does not echo. With neither, the command refuses and names both; a password is never accepted on the command line, and never appears in output or in the database. Passwords shorter than 12 characters are rejected.

An unknown address is created with the address left unverified, so the first login owns verification. An address that already has an account is promoted into the administrator group with its password untouched, which is how a store that has accounts but no administrator is recovered.

```sh
dsh auth bootstrap --email ops@example.com
DSH_BOOTSTRAP_PASSWORD=... dsh auth bootstrap --email ops@example.com --home /srv/dsh
```

The [local-only bootstrap Agent Note](../../.agents/notes/implemented/feature/2026-08-23-auth-bootstrap-cli.md) owns the rationale.

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
