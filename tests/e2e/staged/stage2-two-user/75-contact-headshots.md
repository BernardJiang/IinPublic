# 75-contact-headshots

covers: SPEC-13.1, SPEC-3.1

Ordinary contact rows show a headshot — a real photo or emoji when set, the same "?" fallback the
Relationship modal uses when not. A two-user matched-DM pair verifies the fallback first, then the
peer sets an emoji headshot and the row renders it in a fresh session, and re-sorting/filtering the
contact list does not re-fetch: prefetch is cached per peer via `peerHeadshotCache` in
ui-manager.ts.
