# P2P Roadmap P6 — Active Neighbor Memory

Verifies that the non-production debug/API surface models local-only active neighbor memory:

- neighbor memory defaults to local-only and private
- active low-latency peers become bootstrap candidates before star fallback
- failed endpoints and blocked peers are excluded from bootstrap candidates
- encrypted export and Settings inspector controls are visible
