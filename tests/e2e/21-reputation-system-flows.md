## Reputation system flows (E2E)

Validates the reputation write/read loop end-to-end:

1. **Age verification vouch votes accumulate to threshold**:
   - Calls `POST /api/users/:id/age-verify` repeatedly
   - Confirms `reputation.ageVerificationVotes` increments and `reputation.ageVerified` flips to `true` at the threshold.
2. **Peer star rating updates reputation**:
   - Creates a contact relationship between two users via a match talk
   - Submits a star rating in the Contact Relationship & Credit dialog
   - Confirms reputation fields (`starRating`, `reviewCount`, `likedCount`, `dislikedCount`) and verifies the UI reflects the new star rating.
3. **Block count propagation**:
   - Uses the Contact Relationship dialog block/unblock toggle
   - Confirms `reputation.blockCount` on the blocked user increments and then returns to `0` after unblock.

