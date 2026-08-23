# 91-safety-toast-once-per-day

covers: SPEC-7.4 (FR-FIN-1), TODO §CC

Alice broadcasts a talk and Tom answers it to form a match. FR-FIN-1's mandatory
financial-safety reminder must appear as a toast at most once per day per checkpoint:
T1 fires right before a talk is sent/broadcast, T2 right after a match is found. This
spec drives the real UI triggers — a real click on Broadcast, a real match — and proves
both checkpoints fire once, get suppressed on an immediate repeat within the cooldown
window, and return once the cooldown's `localStorage` timestamp is made to look like a
day has passed. T1's three cycles are driven end to end through real repeated broadcasts;
T2's cooldown arithmetic (after its wiring into a real match is proven once) is exercised
through the same production method a second match would call, to avoid re-testing mesh
delivery reliability already covered elsewhere.
