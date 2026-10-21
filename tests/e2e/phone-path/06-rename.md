# 06 — Rename on a phone (J-PROFILE-01)

Alice and Bob are on two phones in the same room. Alice changes her name in Settings → Profile.

- Her TechSupport welcome now greets her by the new name, and still does 20 seconds later.
  Before the fix (2026-10-15) the conversation list went back to the old name within about five
  seconds: the welcome is rewritten under the same message id, and the message subscription
  (`GunMessageStore.subscribeToMessages`) only re-emitted when the list of ids changed, so the
  TechSupport transport's 5 s poll kept feeding the old text back. Found on real phones by
  `native-app/08` and `09`, whose setup waits for a welcome that names the user.
- Bob, on the other phone, sees Alice under her new name in the room's member list.
