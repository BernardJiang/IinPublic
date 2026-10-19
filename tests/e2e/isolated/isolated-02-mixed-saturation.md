# isolated-02-mixed-saturation

covers: SPEC-3.7

Six browser profiles in one Chromium boot into Nearby at the same point, so each one's list holds
the other five. User 0 creates one Talk of each type (flow, tag, survey, route) and sends all four to
the other five at once: twenty deliveries over links that must be opened under load.

Checks:

- every receiver gets all four Talks within a minute (over the mesh, or the mailbox when a link is
  slow to open), each in its own cluster with no cross-talk;
- afterwards every Nearby list still holds the other five. A link that cannot be opened is no proof
  that someone left: it only triggers a swap with them, and only a silent swap drops a person
  (this load once emptied live lists when a failed link dropped people at once);
- the browser's Gun `talks` keys stay bounded (Talk bodies travel by mesh, not Gun).
