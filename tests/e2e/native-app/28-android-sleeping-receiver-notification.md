# 28 — Sleeping Android 12+ receiver is notified of a Talk (OPEN-38)

Gated by `E2E_REAL_ANDROID_SLEEP_NOTIFY=1`; resets app data on both phones.

1. Sender (`NATIVE_APP_ANDROID_SENDER`, default P30) and receiver (`NATIVE_APP_ANDROID_SLEEPER`,
   default C10 tablet, Android 14) join Global against a local hub.
2. The receiver goes to sleep (`KEYCODE_SLEEP` + `dumpsys deviceidle force-idle`), which freezes
   its WebView page.
3. The sender broadcasts a Talk; the frozen receiver can't ACK, so it goes to the mailbox.
4. The receiver's foreground service (MailboxWatcher) sees a new envelope id and posts the
   "new activity" notification (`iinpublic_activity` channel) — checked via `dumpsys notification`.
5. Waking and opening the app drains the mailbox; the Talk appears in the receiver's IN list.

Prerequisite: the receiver must unlock without a PIN/pattern (screen lock "None" or "Swipe"),
otherwise the app launches behind the keyguard and its page never renders.
