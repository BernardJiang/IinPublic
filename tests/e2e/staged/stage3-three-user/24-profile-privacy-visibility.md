# Test: Profile Privacy on the Public API and Peer UI

covers: SPEC-3.1, SPEC-7.5  <!-- auto-seeded; refine by hand -->

**Features tested:** Public profile Q&A filtering, owner-private rows and peer rendering

---

## What this test does (in plain English):

1. **Tom creates profile Q&A rows** with three visibility levels:
   - Public
   - Contacts only
   - Private
2. **Two viewers are prepared:**
   - JerryNonContact (not linked to Tom)
   - JerryContact (tries the retired unauthenticated contact API)
3. **JerryNonContact opens Tom's peer detail:** should see only public Q&A.
4. **JerryContact opens Tom's peer detail:** sees only public Q&A until authenticated contact sharing exists.
5. **Private and contacts-only Q&A remain in Tom's private store.** A claimed owner `viewerId` cannot reveal them, and the retired contact write returns HTTP 410.

## Verifications:

- ✅ `public` rows are visible to everyone.
- ✅ `contacts_only` rows are absent from the unauthenticated public API and peer UI.
- ✅ `private` rows are hidden from all non-owner viewers.
- ✅ Peer detail UI reflects public profile filtering.
