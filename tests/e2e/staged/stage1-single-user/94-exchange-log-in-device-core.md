# 94 — The exchange log in the device core

**File:** `tests/e2e/staged/stage1-single-user/94-exchange-log-in-device-core.spec.ts`

OPEN-91 P1 / OPEN-88 part 2 (`docs/design/device-core-architecture.md`): the exchange log lives
in the device core's Gun (`local/exchanges`, IndexedDB on the web), and screens read the GUI's
in-memory view of it.

1. An earlier version's exchanges sit in the old `localTalkExchanges` localStorage blob.
2. Opening Contacts reads the log: the blob is imported (one record per person, Talk and
   direction) and removed; both people are listed.
3. After a reload the exchanges come back from the device core — localStorage holds no blob —
   and Contacts still lists both people.
