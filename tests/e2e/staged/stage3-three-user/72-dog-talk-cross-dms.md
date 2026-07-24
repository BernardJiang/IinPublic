# 72 — Dog tag talk, two matches, and a full DM mesh verified both ends

covers: SPEC-7.5, SPEC-19.4  <!-- three-user match + pair-private DM delivery -->

Three users share the same stable chatroom over a fully-connected WebRTC mesh:

1. Adam creates and broadcasts a `dog` tag talk to everyone.
2. Bob and Carol both answer MATCH ("Yes, I like dogs"), so Adam holds two pair
   conversations: Adam↔Bob and Adam↔Carol.
3. Bob and Carol also open a direct pair conversation with each other.
4. Every user then DMs the other two — each user is both sender and receiver
   (six directed messages):
   - Adam → Bob:  "What kind of dog do you like?"
   - Bob → Adam:  "Only big ones."
   - Carol → Adam: "How many dogs do you have?"
   - Adam → Carol: "only one."
   - Bob → Carol:  "Carol, do you like big dogs?"
   - Carol → Bob:  "Yes Bob, I love them."

Every message is asserted on BOTH the sender's and the receiver's `#conversation-messages`.
Each send happens in a freshly-opened conversation, so this also guards the send-routing
path when a user holds more than one conversation. A final pass confirms the three pair
threads stay isolated — no message from one pair leaks into another.
