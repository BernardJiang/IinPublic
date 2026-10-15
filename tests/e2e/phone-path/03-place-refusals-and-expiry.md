# Phone path 03 — Place refusals and expiry

Every refusal goes from the New Room dialog to the phone's node, which publishes at the hub
first and passes the hub's answer back. Each case is checked on screen and in the hub's own list.

1. **Too few contacts** (J-PLACE-08): with a 3-contact minimum, New Room shows "at least 3
   contacts… You have 0" and the dialog does not open.
2. **One Place per person** (J-PLACE-08): Alice's second Place is refused with "You already have a
   room, <first>"; the hub and her phone list only the first.
3. **Same name** (J-PLACE-09): Bob on the other phone types Alice's name in different case and
   spacing; he is told it exists and is moved into her Place; the hub has both of them in it.
4. **Full cell** (J-PLACE-09): four more people fill the cell to five Places; a sixth is refused
   with "already has 5 rooms", and nothing is added on the hub or the phone.
5. **Hub unreachable** (J-PLACE-10): on a phone node whose hub is down, creating a Place shows
   "Could not create room: … reach the network" and nothing is kept on the phone.
6. **Expiry** (J-PLACE-11): a Place both phones have held is aged 31 days on the hub and both
   phones (`POST /api/test/chatrooms/:id/backdate`, non-production only). The hub and both phones
   stop listing it, new users on the web and on a phone never see it, and its creator still does.
