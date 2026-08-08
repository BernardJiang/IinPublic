# route-hr-hiring-match-detection

Regression coverage for a sender-side bug: `checkIfMatch`/`checkIfIgnore`
unconditionally treated `type: 'route'` talks as non-matches, so a route talk's
sender never registered a match no matter what the receiver answered, even though
the receiver's own screen correctly showed "Match."

An HR agent publishes a route talk — "Which position are you applying for?" —
with two distinct match points at different depths (Accountant → CPA screen,
Engineer → portfolio screen) and two immediate root-level rejects (Doctor,
Lawyer). Four jobseekers answer: Alice (accountant, licensed) and Bob (engineer,
has a portfolio) match; Carol (doctor) and Dave (lawyer) do not.

Assertions are on the HR agent's own view — the side the bug broke:

- all four candidates appear in Contacts (any exchanged talk creates a contact
  entry, matched or not — confirmed by reading `deriveLocalPeers`/
  `peersFromLocalTalkExchanges`; this is intended interaction history, not a
  match-only list)
- each contact's own `data-matched-talks` attribute is `1` for Alice/Bob and `0`
  for Carol/Dave
- the Talks-tab stats line on the HR agent's own talk row reads
  `Responses: 4 · Matches: 2`
