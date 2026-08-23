# auth/ — authentication and authorization family

English | [中文](README.zh.md)

This family answers two questions for every Host request: which user it speaks for, and what that user's groups permit. Composing it in turns a single-user harness into a multi-user one; leaving it out keeps the `local` principal and today's behavior.

| Package | Role | ctx key |
|---|---|---|
| [`auth/`](auth/README.md) | Defines the principal, the permission vocabulary, and the password and token primitives | `ctx.auth` |
| [`auth-sqlite/`](auth-sqlite/README.md) | Stores users, groups, rules, sessions, one-time secrets, ownership, and the audit log in one SQLite database | provides `ctx.auth` |

Authorization is decided on the Host, never in the browser: hiding a control in a page is a courtesy to the person using it, while the refusal that matters happens where the operation runs. A client that crafts the request by hand meets the same answer.

Secrets are one-way by construction. Passwords are stored as scrypt hashes, and session tokens and one-time codes are stored as digests, so a copy of the database yields no credential that can be replayed.
