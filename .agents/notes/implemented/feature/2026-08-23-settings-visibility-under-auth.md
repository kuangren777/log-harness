# Agent Note: A refused settings section is absent, not broken

Status: implemented

English | [中文](2026-08-23-settings-visibility-under-auth.zh.md)

## Problem

With authentication mounted, the configuration plane is administrator-only: `settings.describe`, the settings writes, `credentials.*`, `skill.inventory`, `llm.discoverModels`, and the agent-preset authoring methods are all `admin` rows. The browser did not know that. A non-administrator opening Settings still saw General, Models, Skills, Plugins, and Agent presets in the navigation, and clicking one rendered a raw `HTTP 403` with a Retry button — the transport's own words, offered as a product state, with a control that would never succeed.

The Access section, written alongside the administration RPCs, already degraded to an explained empty state. That asymmetry is what made the defect obvious: one section knew the answer and the rest guessed.

## Decision

### The mirror reports reach, not just failure

`SettingsMirrorSnapshot` gains `reach: 'unknown' | 'granted' | 'refused'` beside `status` and `error`. A refusal is a decision that will not change on retry; a transport failure is a blip that will. Collapsing them into one `error` string is what produced a Retry button for an answer the Host had already settled. Every derived surface now reads the Host's own answer instead of pattern-matching an error message.

### A section the caller cannot use does not register

Sections whose whole purpose is the refused plane — Models with both its onboarding steps, Plugins, Skills — are not registered at all when reach is `refused`. Hiding the entry is the honest form here: the page has nothing to show and no action to offer, so an empty state would be a row that exists only to apologise. The composer's model picker is unaffected: it reads the catalog the Host still serves through `llm.models`, which is a `user` row and lives in a different package.

### The client is not the authority

Hiding a section grants nothing. Every one of these methods is refused on the Host for the same caller, and the table-driven policy sweep proves it for every `admin` row. If this code were deleted, a non-administrator would see the sections again and every call inside them would still fail — which is the correct relationship between a refusal and its rendering.

## Alternatives considered

**Render every section with an explained empty state.** Rejected for sections that are wholly administrator-owned: five apologetic rows in a row is worse than a shorter list. The Access section keeps its empty state because an administrator is expected to look for it and needs to learn why it is not theirs.

**Match on the 403 status inside each section.** Rejected — it puts a transport detail in five packages and leaves the sixth wrong whenever someone adds it.

## Consequences

A non-administrator's Settings dialog is short and truthful. A deployment without authentication is unchanged: reach stays `granted` and every section registers as before. A section added later must decide its own behaviour, and the reach field is what it reads to do so.
