# Phone path 02 — Talk, match and chat across two phones

Alice (phone A) and Bob (phone B) stand at the same spot: they land in the same Nearby room and
see each other in it. Alice writes and broadcasts a flow Talk; Bob receives it and gives the
matching answer; both get the conversation and the direct P2P channel connects; a message Alice
sends appears on Bob's screen.

It then checks that sending never makes anyone wait (J-CHAT-04,
`tests/e2e/journeys/dm-speed-journey.ts`): in both directions the composer clears and Send stays
free at once, the sender sees the message within 500 ms and the receiver within 2 s, including
while the sender's local save is held back 4 s. Two quick messages arrive in order, and every
message shows exactly once.
