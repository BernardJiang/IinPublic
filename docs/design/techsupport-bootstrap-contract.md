# TechSupport Bootstrap Contract

TechSupport is a bootstrap/system presence, not an interchangeable ordinary user.

## Invariants

- The canonical root id is `iinpublic-root-techsupport`; the canonical stage name is `TechSupport`.
- An empty network must create or seed TechSupport before the first ordinary user is created.
- A first-time ordinary user must not claim the TechSupport id or stage-name reservation.
- Every ordinary user gets one support channel with TechSupport and one deterministic welcome message:
  `support_welcome_<userId>`.
- Support-channel messages are durable through the support transport. Ordinary user-to-user messages remain separate from support channels.
- User-facing room totals may include TechSupport when they describe total presence. Ordinary-user assertions and status-bar counts must exclude TechSupport or explicitly say they are total presence.
- User-facing lists that show TechSupport must label it as built-in/bootstrap support, not as a normal peer.

## Current Enforcement

- `src/shared/techsupport.ts` reserves the TechSupport name and root id.
- `IinPublicApp.bootstrapTechSupportRootIfMissing()` ensures root bootstrap before first ordinary login.
- `IinPublicApp.countOrdinaryRoomMembers()` excludes TechSupport from ordinary status-bar counts.
- Contacts render TechSupport with `data-support-contact="true"` and built-in support copy.
- Chatroom member rows render TechSupport with built-in support status copy.
- E2E helper bootstraps assert root-vs-ordinary identity through `tests/e2e/helpers/techsupport-contract.ts`.

## Verification

- `tests/e2e/staged/stage1-single-user/01-login-single-user-headcount.spec.ts`
- `tests/e2e/staged/stage2-two-user/00k-techsupport-contact-mute.spec.ts`
- `tests/e2e/staged/stage2-two-user/34-contacts-filter-name.spec.ts`
- `src/test/unit/techsupport.test.ts`
