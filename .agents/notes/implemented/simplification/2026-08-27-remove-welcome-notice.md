# Agent Note: Remove the welcome-notice onboarding step

Status: implemented

English | [中文](2026-08-27-remove-welcome-notice.zh.md)

## Problem

The [shared-modal product onboarding](../feature/2026-08-13-shared-modal-product-onboarding.md) decision restored a concise first-run notice in `ui-settings-models` after the original [full-viewport beta notice removal](2026-08-13-remove-first-run-beta-notice.md), reusing the `ui-onboarding.welcomeNoticeVersion` field. That notice still opened with the shipped copy's "内测声明" / "Internal Testing Notice" framing. The product is now deployed for external users behind an authenticating gateway, so a DeepSeek-branded internal-testing interstitial is the wrong copy for that audience. Once the internal-testing framing is removed, the step carries no material first-run content — the version field exists only to gate re-showing that framing — so a mandatory blocking dialog with nothing to say is pure friction, the same failure mode the original removal identified.

## Decision

This decision deletes the welcome-notice onboarding step from `ui-settings-models` rather than rewording it. `WelcomeNotice.tsx`, `WelcomeNotice.module.css`, `welcome-store.ts`, and their specs are removed; `src/onboarding-copy.ts` — which held only the welcome copy, version, acknowledgement field, and the `WELCOME_NOTICE_SETTINGS_NAMESPACE` re-export — is deleted whole, since nothing else in the package consumed it. `index.ts` no longer registers a `welcome-notice` entry in `settings.onboarding`; the `deepseek-official` step is now the sole occupant and keeps the existing `OnboardingModal` wrapper for its own chrome. `locales.ts` drops the `welcomeTitle`/`welcomeBody`/`welcomeContinue`/`welcomeError` keys. As with the original removal, the Host side (`ui-settings-general`) keeps the `ui-onboarding` settings namespace registered so a document an earlier build wrote (`welcomeNoticeVersion`) still validates; no shipped code reads or writes that field anymore.

## Alternatives considered

**Reword the copy to drop the internal-testing framing and keep the step.** Rejected: once the DeepSeek-branded testing framing and the historical telemetry instructions (already absent since the 2026-08-13 removal) are both gone, no first-run statement remains material enough to justify a mandatory blocking dialog before the credential step — restoring exactly the friction the original removal eliminated.

**Gate the notice behind a deployment flag instead of deleting it.** Rejected: no current per-deployment configuration seam distinguishes an internal-testing build from an externally gated one, and introducing one solely to hide a component with no remaining content is not justified by a current consumer.

**Deregister the `ui-onboarding` namespace along with the step.** Rejected for the same reason the original removal gave: existing settings documents already carry the section, the settings seam validates stored documents against registered namespaces, and keeping the registration keeps those documents valid at no cost.

## Consequences

`settings.onboarding` now mounts only the official-DeepSeek credential step; `OnboardingModal` remains available as shared chrome for that step and any future one, but currently wraps a single occupant. The `ui-onboarding` namespace and its `welcomeNoticeVersion` field remain registered and durable-compatible but unused by any shipped step. This removal supersedes the notice-restoration half of the [shared-modal product onboarding](../feature/2026-08-13-shared-modal-product-onboarding.md) decision; that note's shared-modal-chrome and credential-step decisions remain current.
