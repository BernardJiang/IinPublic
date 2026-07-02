# Mobile Conversation Messages

Bootstrap two users (MobA on desktop, MobB on a 390x844 mobile viewport) already matched via
the fast pair-direct setup, with both conversation overlays open. Verify B's conversation
overlay, message input, and send button fit inside the 390px viewport with no horizontal
page overflow. A sends two messages and B replies with one; all three become visible on both
sides. Confirm message bubbles on B's screen stay within the viewport width, the message list
is scrollable, and the send button is tappable (a real tap-driven send round-trips to A).
