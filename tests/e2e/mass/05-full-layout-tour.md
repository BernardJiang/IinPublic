# 05 — Full layout tour (screenshot manifest)

covers: SPEC-26.2

Walks every reachable layout of the app — every tab plus every popup, dialog, and overlay
reachable from a data-heavy user — capturing one full-page screenshot per state plus a
manifest for docs/gui-layout-review PDFs. Not a correctness test; its only assertions are that
each layout opens. Run with E2E_SCREENSHOT_DIR set.
