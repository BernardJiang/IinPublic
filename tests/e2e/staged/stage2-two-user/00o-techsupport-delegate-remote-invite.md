# 00o — TechSupport delegate: remote invite (no code / QR)

A redundant alternative to 00m's invite-code/QR handshake that needs no physical proximity.

1. Dana registers as an ordinary user.
2. TechSupport (real master key) opens Settings → Delegates → **Invite a user remotely**, enters
   Dana's user ID, presses **Look up** to see her name + fingerprint, then **Send invite**.
3. Dana's client finds the invite addressed to her identity (relay poll) and shows an
   Accept/Decline card in Settings → Support delegate. She accepts.
4. Her signed request appears under Pending in the master's panel; the master approves it.
5. Dana now sees the delegate opt-in toggle — same end state as the code/QR path.
