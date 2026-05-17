# Test: Profile Privacy Visibility by Viewer Relationship

**Features tested:** Profile Q&A visibility controls (`public`, `contacts_only`, `private`) and viewer-scoped rendering

---

## What this test does (in plain English):

1. **Tom creates profile Q&A rows** with three visibility levels:
   - Public
   - Contacts only
   - Private
2. **Two viewers are prepared:**
   - JerryNonContact (not linked to Tom)
   - JerryContact (added to Tom's known-people list via API)
3. **JerryNonContact opens Tom's peer detail:** should see only public Q&A.
4. **JerryContact opens Tom's peer detail:** should see public + contacts-only Q&A.
5. **Private Q&A remains hidden** for both non-owner viewers.

## Verifications:

- ✅ `public` rows are visible to everyone.
- ✅ `contacts_only` rows are visible only to known contacts.
- ✅ `private` rows are hidden from all non-owner viewers.
- ✅ Peer detail UI reflects server-side profile-privacy filtering.
