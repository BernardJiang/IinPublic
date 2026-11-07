# 00an-presence-indicator-parity

covers: SPEC-6.1, SPEC-13.1

Verifies presence-indicator parity for an ordinary peer across two surfaces: the chatroom member
list and the Contacts tab. Tom and Jerry join Global, so Jerry's member-list row starts with an
"away" `.presence-indicator`; after a real talk match, Jerry also appears as a Contacts row.
Simulating a presence refresh with Jerry in the online set flips his dot to "online" in BOTH the
member list (a live DOM patch, no re-render) and the freshly rendered Contacts list. A peer not
in the online set stays "away", proving the default isn't stuck on.
