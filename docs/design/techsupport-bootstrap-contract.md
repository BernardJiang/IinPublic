# TechSupport Bootstrap Contract

TechSupport is a bootstrap/system presence, not an interchangeable ordinary user.

## Invariants

- The canonical root id is `iinpublic-root-techsupport`; the canonical stage name is `TechSupport`.
- TechSupport is the built-in **first user** of the network: an empty network must create or seed TechSupport before the first ordinary user is created.
- In dev (`npm run dev`, `dev:stage-empty`, `dev:stage-zero`) the database starts clean and the browser boots logged in as the TechSupport root — an empty network shows a headcount of 1. `dev:multi` seeds TechSupport server-side instead and keeps the launched browsers as ordinary users.
- A first-time ordinary user must not claim the TechSupport id or stage-name reservation.
- Every ordinary user gets one support channel with TechSupport and one deterministic welcome message:
  `support_welcome_<userId>`.
- Support-channel messages are durable through the support transport. Ordinary user-to-user messages remain separate from support channels.
- **Headcounts count TechSupport as exactly 1 in all cases** — status bar, chatroom list badges, and any user-facing room total. It is never excluded and never double-counted.
- User-facing lists that show TechSupport must label it as built-in/bootstrap support, not as a normal peer.

## Current Enforcement

- `src/shared/techsupport.ts` reserves the TechSupport name and root id.
- `IinPublicApp.bootstrapTechSupportRootIfMissing()` ensures root bootstrap before first ordinary login.
- `IinPublicApp.countRoomMembers()` counts every unique member — TechSupport included — as 1 for the status bar.
- `src/web/index.ts` logs a `stage-zero`/`empty` dev boot in as the TechSupport root (`isDevStageTechSupportLoginResolved`).
- Contacts render TechSupport with `data-support-contact="true"` and built-in support copy.
- Chatroom member rows render TechSupport with built-in support status copy.
- E2E helper bootstraps assert root-vs-ordinary identity through `tests/e2e/helpers/techsupport-contract.ts`.

## Verification

- `tests/e2e/staged/stage1-single-user/01-login-single-user-headcount.spec.ts`
- `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`
- `tests/e2e/staged/stage2-two-user/34-contacts-filter-name.spec.ts`
- `src/test/unit/techsupport.test.ts`
