# 07b — A rebuilt direct link comes up at once, whichever phone rebuilds it

Two phone nodes share Nearby and open a direct link. Each phone in turn rebuilds the link with
`reconnect()` (what the Wi-Fi Direct switch does), twice each. Every rebuild must succeed by itself,
not only "eventually" when the old link times out, and both phones must end on the same confirmed
encrypted session.

Found on real phones on 2026-10-18 (`native-app/39`, OPEN-74): each pair's first reconnect failed
online, and over an offline Wi-Fi Direct group all of them did. The phone that answered applied the
new offer to its old connection; a phone that only answers offers never got a new one after
rebuilding its own side.
