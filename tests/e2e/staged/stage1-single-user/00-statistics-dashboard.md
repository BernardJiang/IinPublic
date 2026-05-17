# 00-statistics-dashboard

**Features tested:** Contextual statistics without a bottom Stats tab, aggregate response totals, and match-rate copy.

## Flow

1. Clears the worker Gun/server state.
2. Writes three normalized stats records through `POST /api/stats/talks/:id/record`.
3. Opens the web app, verifies there is no bottom-nav **Stats** tab, and navigates to **Talks**.
4. Verifies the contextual stats strip renders response totals and match-rate copy.

## Why this matters

The statistics surface is no longer a separate bottom tab. This confirms aggregate statistics are embedded where users work.
