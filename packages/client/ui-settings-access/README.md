# dsh-client-ui-settings-access

English | [中文](README.zh.md)

The administration side of [`dsh-auth`](../../auth/README.md) in the browser: one settings section over accounts, permission groups, membership, and the rules a group carries. It is the client half of the gateway's nine `auth.admin.*` methods, and it decides nothing — every refusal it shows is the Host's own.

Mounting the row is harmless in a deployment that does not authenticate. The section's first call is `me` on the request gate's `/auth` channel; a deployment that mounts no gate has no such route, and the page says there is nothing to administer instead of offering forms that cannot work.

## Hiding the page is a courtesy, not the control

The section registers for everybody. What decides whether it renders forms is the gate's answer to `me`: an administrator gets the page, and anyone else gets one paragraph saying administration is not theirs. Nothing about that is a security boundary — the gateway marks all nine methods `admin` and refuses each one from a non-administrator whether or not a browser ever draws a button. Asking first buys two things instead: the page can explain itself, and it never issues a call it already knows will be refused.

## Accounts

The roster is every account, unfiltered and unpaged, because that is what the seam answers. Creating one takes an address and an initial password; delivering that password to its owner is the administrator's problem, and the page never shows it again. **Disable** blocks an account from authenticating and **Restore** undoes it — a live session of a disabled account is untouched, because ending sessions is a separate decision the seam exposes separately.

## Groups and membership

A group is created empty. The builtin administrator group renders with neither a rename nor a delete control, because membership in it is what makes an administrator and the seam refuses both operations on it. Membership is saved whole: ticking one account submits the group's entire roster, and the Host mails a notice only to the accounts that were not members before.

## Rules, and the lockout the editor refuses to let you walk into

A rule is a domain, a pattern, and an effect. The pattern is an exact name or a prefix ending in `*`; the domains are skills, tools, `provider/model` routes, and settings namespaces. Precedence is deny over allow over default-deny.

The trap is what a domain's *first* rule does. A domain no rule addresses is fully open, and the first rule addressing it turns the whole domain into an allowlist. So `deny secret-skill` on its own does not block one skill — it blocks every skill, and nothing in the wire format says so.

The editor answers that with its layout rather than with a paragraph. The rules are four cards, one per domain, all four always on screen:

- **The card carries the posture.** Each card badges its domain's reach — open, open with exceptions, allowlist, all refused — with one line under it saying what that leaves a member. A domain nobody has written a rule for is a quiet empty card; writing its first rule turns it solid and moves the badge, which is the algebra happening in front of the administrator rather than being described to them.
- **Rules are chips inside their own card.** An allow is a quiet outline and a denial is the loud chip, because deny wins wherever both match. Each chip removes itself in place.
- **Each card probes a name.** Type a candidate name and the card answers for the current draft: allowed or refused, and which rule decided — the denial that beat a broader allow, the prefix that granted it, or nothing at all, which in a governed domain is a refusal. This is where precedence is stated, because it is where it can be tried.
- **It seeds the catch-all.** Adding a domain's first denial adds an `allow *` rule beside it, and the card it happened in says so. Blocking one thing is then the easy path, and a strict allowlist is one deletion away.
- **Warnings sit on the domain that earned them.** A domain admitting no name at all names the group that loses everything in it; a domain narrowed to explicit allows says every other name is refused.

Below the cards the page resolves the one catalog it can read by name: `skill.inventory` for the current session, split into what a member would see and what the rules refuse. It answers for the draft, unsaved edits included, as do the badges and the probes.

An administrator bypasses rules entirely, so the preview is explicit that it is not answering for the person reading it. Skills are discovered from a session's working directory, so with no session open the page says so rather than previewing an empty catalog.

## Model Experience

None, as the administration surface renders the auth seam's answers in the browser: no account, group, rule, or password enters a model request.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **Only skills are resolved from a real catalog** — the probe answers any name in any domain, but only skills are listed name by name, because the page has no catalog of tools, model routes, or settings namespaces that is filtered the way a member would see it.
- **A rule is added, never edited** — changing a pattern means deleting the row and adding it again; the editor has no in-place field, which is bearable while a group carries a handful of rules and would not be for dozens.
- **Membership is edited from the group, not the account** — there is no per-account view of which groups it belongs to, so moving one person across several groups is one save per group.
- **A refused save reports the seam's own text** — a duplicate address, a duplicate group name, and an unknown id all surface as one error line above the forms rather than pointing at the offending field, even though the wire carries the machine-readable `authCode` that would allow it.
