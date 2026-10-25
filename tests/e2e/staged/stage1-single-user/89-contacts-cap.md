# Test: Contacts cap

covers: OPEN-87 S5

**File:** `89-contacts-cap.spec.ts`

1. Seeds 600 people this user only exchanged Talks with (one day apart) and one Friend.
2. Settings → Talk behavior shows the default cap 1,000; choosing 500 prunes at once.
3. The 100 oldest exchange-only people lose their exchange records and leave Contacts; the newest
   stay; the Friend (an explicit Contact) stays however old.
4. A new exchange with a pruned person brings them back.
