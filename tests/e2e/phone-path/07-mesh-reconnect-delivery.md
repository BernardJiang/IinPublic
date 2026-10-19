# 07 — A Talk still arrives after the direct link is rebuilt

Two phone nodes share a Nearby room. The phone that makes the WebRTC offer rebuilds its direct
link to the other three times (the same `reconnect()` the Wi-Fi Direct switch uses). After each
rebuild both phones must hold the same confirmed encrypted session, and a Talk Alice sends at the
end must reach Bob.

Found on real phones on 2026-10-18 (`native-app/39`): after a reconnect the previous channel's
handshake could finish late, the two phones derived different sessions, and the pair stayed
"connected" while nothing crossed it. The exact race needs a slow contact-key lookup and is pinned
by `src/test/unit/p2p-session-handshake-race.test.ts`; this journey checks what the user sees.
