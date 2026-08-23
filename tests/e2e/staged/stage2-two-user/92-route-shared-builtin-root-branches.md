# 92-route-shared-builtin-root-branches

covers: SPEC-30.5, TODO §BB

Before this spec, a route talk's builtIn (typed comparison) node — quantity, priceRange,
timeFrame, location — could only ever be a branch's own terminal leaf: the route editor had no
affordance to attach a child to a builtIn node's single implicit "Compatible" outcome. Spec
§30.5 describes exactly the shape this blocked: shared attributes (timeFrame, location) asked
once at the talk root, then the route branches into per-item questions.

Alice builds a route talk with a builtIn `timeFrame` question at the root, branching (via the
editor's new "+Add Child" affordance on a builtIn node) into an ordinary "Which item?" choice,
each item ending in its own builtIn `quantity` leaf. The spec verifies the structure survives a
save/reopen round trip (the child link, not Match/Ignore), then has Bob — a real second browser
— walk the whole DAG as a human responder: past the shared root, into the item branch, to a
real match. Uses `timeFrame` rather than `location` for the shared root to keep the test
deterministic (plain dates, no geolocation mocking needed).
