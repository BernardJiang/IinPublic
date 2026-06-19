# Test: Chinese UI Edge Surface Localization (D2)

**File:** 00z-chinese-edge-notifications.spec.ts  
**Features tested:** Status bar, broadcast preamble modal, talk response dialog, and chatroom create modal labels in Chinese. Complements 00y which covers main tabs; this spec hits surfaces not exercised there.

---

## What this test does (in plain English):

Switches to Chinese UI, then exercises non-tab surfaces — status bar user count text, broadcast confirmation modal, talk response modal, and chatroom creation modal — and verifies every label is in Chinese.

1. **Setup:** Single browser. Switch UI language to `zh`.
2. **Status bar localization:** Navigate to Chatrooms → click Global room → after sync, status bar shows Chinese user count (e.g., "N 位用户") not English "N user(s)".
3. **Broadcast preamble modal:** Create talk "D2 Edge Test Talk" → switch to Talks → broadcast from chatroom. Inject synthetic peer so modal appears. Verify:
   - Cancel button shows "取消"
   - Send Broadcast shows "发送广播"
   - Modal dismisses correctly
4. **Chatroom create modal:** Click "Create custom room" → modal title contains "新建聊天室", Cancel/ Create buttons localized.
5. **Talk response dialog (conditional):** If an incoming talk exists, click it → response modal Submit button shows "提交" not English — verified by checking for absence of `\bSubmit\b` regex match.

## Verifications:

- ✅ Status bar uses Chinese i18n key for user count display
- ✅ Broadcast preamble modal localized (Cancel 取消, Send 发送广播)
- ✅ Chatroom create modal fully localized (新建聊天室 + button labels)
- ✅ Talk response dialog Submit button shows "提交" in Chinese mode
- ✅ No English leakage — explicit negative assertions on `\bSubmit\b` and `\buser(s)?\b`

> **Why this matters:** 00y checks tab-level surfaces; this spec ensures deep-dialog/i18n coverage for edge cases that only appear during broadcast workflows, modals, and notifications — the areas most likely to fall through in localization.

---

**Helpers used:** `clearGunForStage1Spec`, `injectIdbClear`, `gotoWebApp`, `afterNav`, `afterSync`, `afterCreateTalkBeforeBroadcast`
