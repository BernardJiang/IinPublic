# 00-statistics-dashboard

**Features tested:** Statistics dashboard navigation, aggregate response totals, talk-type breakdown, peer summary, source-of-truth/privacy copy.

## Flow

1. Clears the worker Gun/server state.
2. Writes three normalized stats records through `POST /api/stats/talks/:id/record`.
3. Opens the web app and navigates to the bottom-nav **Stats** tab.
4. Verifies the dashboard renders response totals, match-rate copy, survey/talk-type data, peer summary, and source-of-truth text.

## Why this matters

The statistics surface is no longer only a survey row modal. This confirms users have a dedicated dashboard entry point that can show current aggregate statistics.
