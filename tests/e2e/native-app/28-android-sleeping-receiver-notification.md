# 28 — Sleeping Android 12+ receiver is notified of a Talk (OPEN-38)

Gated by `E2E_REAL_ANDROID_SLEEP_NOTIFY=1`; resets app data on both phones.

1. Sender (`NATIVE_APP_ANDROID_SENDER`, default P30) and receiver (`NATIVE_APP_ANDROID_SLEEPER`,
   default C10 tablet, Android 14) join Global against a local hub.
2. The receiver goes to sleep (`KEYCODE_SLEEP` + `dumpsys deviceidle force-idle`), which freezes
   its WebView page.
3. The sender broadcasts a Talk. Direct delivery keeps the body in the sender's outbox. Once the
   receiver's presence has lapsed (use `E2E_SLEEP_SETTLE_MS=300000`), the sender posts a
   content-free wake ping to the receiver's mailbox (OPEN-38).
4. The receiver's foreground service sees the new envelope id and posts the "new activity"
   notification (`iinpublic_activity` channel), checked via `dumpsys notification`. It notices
   either through its idle-allowed alarm poll or through its open `/api/mailbox/<id>/wait`
   long-poll, which wakes on network data even where the vendor withholds alarms (OPEN-44, C10).
5. Waking and opening the app reconnects; the direct scheduler delivers the Talk, which appears
   in the receiver's IN list.

Prerequisite: the receiver must unlock without a PIN/pattern (screen lock "None" or "Swipe"),
otherwise the app launches behind the keyguard and its page never renders.
