# 00-statistics-dashboard

covers: SPEC-3.6  <!-- auto-seeded; refine by hand -->

**Features tested:** Contextual statistics without a bottom Stats tab, aggregate response totals, and match-rate copy.

## Flow

1. Clears the worker Gun/server state.
2. Writes three normalized stats records through `POST /api/stats/talks/:id/record`.
3. Opens the web app, verifies there is no bottom-nav **Stats** tab, and navigates to **Talks**.
4. Verifies the AppBar's links line on Talks counts the 3 people the Talk reached ("👥 3 people"). There is no stats line inside the view any more (owner, 2026-11-16).

## Why this matters

The statistics surface is no longer a separate bottom tab. This confirms aggregate statistics are embedded where users work.
