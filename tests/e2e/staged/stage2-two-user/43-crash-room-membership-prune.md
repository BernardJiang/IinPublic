# 43-crash-room-membership-prune

covers: SPEC-3.3, SPEC-8.2

Like 42, but Bob's whole browser process is SIGKILLed, as an OS-level crash would. Alice's next swap
with Bob gets no answer, which drops him from her Nearby list; her headcount falls from 2 to 1.
