# Test: TechSupport Contact and Mute

covers: SPEC-7.9, SPEC-12.4  <!-- auto-seeded; refine by hand -->

**File:** 00k-techsupport-contact-mute.spec.ts  
**Features tested:** TechSupport user appears in Contacts list with `data-support-contact="true"` attribute. Muting disables toasts from TechSupport without altering contact visibility.

---

## What this test does (in plain English):

Single-user test verifying the TechSupport identity contract within the Contacts and Settings UI. Validates that TechSupport cannot be deleted/muted through the contacts interface, mute persists across reloads, and support-contact metadata is always surfaced correctly.

1. **Setup:** Launch one browser. Log in as user "TS Contact User" with avatar 🗞️.
2. **Contacts tab opens → TechSupport row visible** with `data-support-contact="true"` attribute — distinguishes it from normal contacts. Name, title ("IinPublic Support"), and role badge are rendered.
3. **Contact detail view:** Open the support contact's detail URL (`#/contacts/techsupport-id`). Verify name shows "IinPublic TechSupport", stage matches "TechSupport-0", no delete or edit buttons appear, only "Return button" is actionable.
4. **Chat toggle disabled for support — Settings UI surface:** Navigate to Settings → locate `#settings-ts-chat` checkbox in the Support section → click it to enable → verify the corresponding runtime key is set. Verify `data-support-contact="true"` row remains visible — muting only controls notifications, not presence.
5. **Persistence through reload — storage contract:** Reload page ready and re-open contacts tab → TechSupport row still visible with correct attributes.

## Verifications:

- ✅ TechSupport appears as a permanent support contact (`data-support-contact="true"`)
- ✅ Support contact detail shows name, title/role badge without destructive actions
- ✅ Settings surface for TS-chat toggle present and actionable
- ✅ Muting TS-chat does not remove contact from list — only suppresses toast notifications
- ✅ TechSupport contact persists through page reload

> **Why this matters:** Establishes the immutable support-contact contract. TechSupport is a built-in account (not deletable), its presence and mute state need to be stable to prevent accidental loss of help-access for end users.

---

**Helpers used:** `clearGunForStage2Spec`, `injectIdbClear`, `gotoWebApp`, `afterNav`, `afterSync`, `reloadAppReady`
