# 00n-techsupport-delegate-answers-cold-asker

covers: SPEC-19.7, SPEC-5.3

Regression coverage (real-device, 2026-09-23) for the K7 delegate fan-out: an asker whose client has
never previously synced the delegate roster (a "cold asker") still discovers the currently valid
delegates and addresses encrypted question envelopes to them, so a delegate — not the master — can
answer the question. Mirrors `00m-techsupport-delegate-answers.spec.ts`'s flow with a fresh-booted
asker, proving the roster lookup works with no warm local cache. Requires the real TechSupport
signing key (`TECHSUPPORT_SEA_PAIR_JSON` in `.env.local`); skips otherwise.
