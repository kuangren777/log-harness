# Agent Note: The rules editor names the lockout before it happens

Status: implemented

English | [中文](2026-08-23-access-administration-ui.zh.md)

## Problem

The [request gate](2026-08-23-auth-bootstrap-cli.md) and the [browser sign-in surface](2026-08-23-browser-login.md) let a deployment authenticate, and the gateway grew nine `auth.admin.*` methods over accounts, groups, membership, and permission rules. Nothing reached them from a browser: the first administrator could sign in and then had to leave the product to add the second account.

The administration surface is not hard because of CRUD. It is hard because of one thing the rule algebra does that no form can be innocent about. A domain no rule addresses is fully open, and the FIRST rule addressing that domain turns the whole domain into an allowlist, with deny beating allow and no matching rule meaning refused. So an administrator who writes the obvious thing — `deny secret-skill` — has not blocked one skill. They have blocked every skill the group has, and the wire format, the database, and the seam all accept it silently. The mistake is invisible until a member reports that the product is empty.

## Decision

`@deepseek-ai/dsh-client-ui-settings-access` is a shipped row of the Web bundle registering one `settings.section` (id `access`, order 30, after every section that configures the product for oneself). It reads and writes only through the nine gateway methods, and it changes nothing about the semantics: the fix for the footgun is entirely in what the editor does and says.

### Three defences, none of them a semantic change

**Seeding.** Adding a domain's first rule, when that rule is a denial, also adds a catch-all allow beside it, and the page says that it did. "Block one thing" is then the default path, and a strict allowlist costs one deletion. The seeded row is an ordinary rule with no marker in the payload — the Host must not learn a second kind of rule to make a browser affordance work.

**Warning.** A per-domain analysis classifies the draft as open, open-with-exceptions, allowlist, or locked. `locked` names the group and says it loses everything in that domain; `allowlist` says every unnamed thing is refused. `open-with-exceptions` is silent, which is why the warning disappears the moment a surviving catch-all allow exists.

Deciding `locked` needs more than "there is no allow rule". `allow web_*` with `deny web_*` also admits nothing. The analysis asks the rule set itself: for each allow rule it evaluates a representative name inside that pattern's language — the pattern for an exact name, the prefix plus an untypable probe suffix for a wildcard — and a domain is locked when no representative survives. The probe is a space, which no skill name, tool name, `provider/model` route, or settings namespace contains, so a deny that covers the probe covers the pattern rather than one written exception.

**Preview.** Each domain's card states its own reach, and for skills the page resolves the real catalog: `skill.inventory` for the current session, split into what a member would see and what the rules refuse. It answers for the draft, so the consequence is on screen before the save. Skills are the only domain resolved by name because they are the only one the page can read as a member would see it; the other three are honestly reported as governed or open rather than guessed at.

### The layout carries the algebra; the preamble did not

The first version of this editor stated the rule in a sentence and then rendered a flat list of `allow · Skill · foo` rows mixing all four domains, with the reach lines and the warnings as prose paragraphs below. The semantics are per domain and the layout was not, so every per-domain fact had to be re-stated in words, and reading one list meant holding four domains' worth of state in your head.

The rules editor is now four cards, one per domain, always all four. The posture badge, the rule chips, the warning, and the seeding notice all sit on the domain they are about, and an ungoverned domain renders as a quiet empty card rather than as absence. Adding a domain's first rule therefore changes that card in front of the person who added it: the badge moves from open to allowlist or open-with-exceptions, the line under it changes, and the probe starts refusing names it granted a second earlier. That state change is the lesson the preamble used to teach, which is why `rulesIntro` is now one line. The grid is `auto-fit` over `minmax(280px, 1fr)`, so the four cards fall to one column in the 640px phone form.

Each card carries a probe: a field for a candidate name, answered against the current draft with the deciding rule named. `probeName` takes the verdict itself from `memberPermits` and adds only the report of which precedence step decided, so the probe cannot disagree with the badge above it. This is where "deny beats allow" and "an unmatched name is refused" are stated, because it is where they can be tried — typing the denied name into a domain that also carries `allow *` answers `Refused`, `Denied by <pattern>: deny beats allow`. It is also the only reading in this package that answers for a name nobody has written a rule about, which is the question an administrator actually has.

Seeding is unchanged, but its notice moved onto the card where the seeding happened, which is what turned `AccessState.seeded: boolean` into `seededDomain: AccessDomain | undefined`.

### The preview needs the unbypassed answer, so the algebra is restated in the browser

`dsh-auth`'s `permits` short-circuits for an administrator, and correctly so. The editor asks the opposite question — what an ORDINARY member of this group would see — about rules that exist only in an unsaved draft, which no wire method can decide. So `rules.ts` carries a second implementation of `matchesPattern` / `evaluate` / `governs` with the bypass deliberately absent, and the module says why. This is a duplicate of about twenty lines of pure function; the alternative was a client package importing a Host package, which the layering forbids, or a wire method for evaluating hypothetical rules, which is a new public operation with one consumer.

### Hiding the section is cosmetic; the server refusal is the control

The section registers for everybody, because a client bundle is built once and a deployment opts into authentication with a host-side overlay. What it renders is decided by the gate's answer to `me`: an administrator gets the page, a signed-in non-administrator gets one paragraph, and a deployment whose `/auth` channel has no route gets a different paragraph saying there is nothing to administer.

None of that is enforcement, and the README and the copy both say so. The gateway marks all nine methods `admin` and refuses each one from a non-administrator whether or not a browser draws a button; a page that hid itself would be exactly as safe and less honest. Asking `me` first buys two other things: the empty state can explain itself, and the surface never issues a call it already knows will be refused — which is also what the unit suite pins, because "renders nothing" and "renders nothing and stays quiet" are different behaviors.

### Membership is saved whole, and the builtin group has no delete control

`members.set` replaces a group's roster and reports which accounts were newly added, so ticking one account submits the whole list and the Host decides who gets mailed. The builtin administrator group renders with neither rename nor delete, because the seam refuses both — the control is absent rather than present-and-disabled, since there is no state in which it would work.

## Consequences

`AdminGroupView`, `AdminRuleView`, `AdminUserView`, `GroupId`, and `UserId` are now re-exported through `dsh-client-connection/client` and `dsh-api-remotes/client`. They were reachable only from the Host packages before, which no client plugin may name.

The browser journey signs in as two different accounts against one host — an administrator who writes the rule, and the member who then finds the denied skill missing from a catalog the Host filtered. That second half is the point of the whole change: the administration page describes a decision, and the enforcement it describes is somebody else's.

`dsh-client-ui-auth`'s "no administration surface" limitation now points here instead of out of the product.

## Alternatives considered

**Changing the semantics so a deny-only domain stays open.** Rejected outright. It would make a denial unable to revoke anything by itself, and it would make the meaning of a rule set depend on which effects it happens to contain. The algebra is right; the affordance was missing.

**Refusing to save a rule set that locks a domain.** Rejected: locking a domain is a legitimate thing to want, and a form that cannot express it forces the administrator to the CLI or the database. Naming the consequence is the correct amount of help.

**Offering the catch-all as a checkbox instead of seeding it.** Rejected: a checkbox on a form that has already been submitted wrong is a second chance to miss it. Seeding makes the safe reading the one that happens by default, and the row is deletable, so nothing is taken away.

**Previewing every domain by name.** Rejected for now: an administrator's own catalog of tools, model routes, and settings namespaces is filtered for THEM, and resolving what a member would see needs either a per-domain unfiltered read the gateway does not offer or a hypothetical-evaluation method. Stating governed-or-open is true and cheap; the README records the gap.

**Hiding the section from a non-administrator instead of rendering an empty state.** Rejected: it looks like a permission model and is not one, and it teaches a reader that absence means refusal — which would be wrong the first time a bundle ships a row a deployment has not authorized.

**Editing a rule in place.** Deferred: with a handful of rules per group, delete-and-re-add is a smaller surface than an editable list with its own dirty tracking. Recorded as a limitation because it stops being true at a few dozen rules.
