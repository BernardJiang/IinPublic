# Room heartbeat load test — results and recommended numbers

Tool: `npm run load-test:room-heartbeat` (`scripts/load-test-room-heartbeat.mjs`). Raw-WebSocket clients speak Gun's wire
protocol against a real relay started as production runs it (`RELAY_ONLY_HUB`, memory-only). One run per row, run on one
Mac with relay and generator together, loopback network (no real latency/bandwidth). Simulated clients, not the real app,
and only heartbeat + roster traffic was generated. Treat as order-of-magnitude, not as capacity guarantees.

Run 2026-09-20 against v1.0.47 (+ the `IINPUBLIC_HUB_AXE` switch). Message on the wire: ~610 B for a full heartbeat
(SEA `epub`/`pub` included), ~400 B without them ("slim").

## Findings

1. **A relay with AXE off (production today) floods every write to every connected client.** 500 clients in one room and
   500 clients in 167 rooms of 3 cost the same (fan-out per write = clients − 1). Room size does not protect the relay; total
   connected clients does, quadratically (N² / heartbeat).
2. **With AXE on** (`IINPUBLIC_HUB_AXE=1`, clients subscribing to room-mates like the roster does) fan-out follows room size.
3. **The join is the expensive part, not the heartbeat.** Each client subscribes to every room-mate's record; the download at
   join was ~12.6 MB at room size 498, ~3.5 MB at 200, ~2.0 MB at 100 (~20 KB per room-mate, includes ramp-time heartbeats).
4. **A crowd joining at once breaks the relay.** 500 clients joining in 12 s (AXE on, rooms of 498) dropped 175 sockets and
   used 2.2 GB RAM; the same crowd spread over 120 s was healthy. Flooding relay + roster subscriptions at 500x498 also
   degraded badly (p95 latency 21 s).
5. **One relay process tops out well below 2,000 connected clients** with the real subscription pattern: 2,000 clients
   (rooms of 100, joins spread over 240 s) dropped 560 sockets with AXE on and had p95 ≈ 45 s with AXE off. Ceiling untested
   between 500 and 2,000 (probably ~1,000). Above that, more relays are needed regardless of room size.

## Measured (AXE on, clients subscribed to room-mates, joins spread over 120 s, 500 clients)

| Room size | Heartbeat | Payload | Per-client KB/s | Msgs/s per client | Join download / client | Relay CPU (% of a core) | p95 latency |
|---:|---:|---|---:|---:|---:|---:|---:|
| 498 | 30 s | full | 10.4 | 16.5 | 12.6 MB | 27 | 42 ms |
| 200 | 30 s | full | 3.85 | 6.0 | 3.55 MB | 16 | 27 ms |
| 100 | 30 s | full | 2.16 | 3.3 | 2.0 MB | 13 | 23 ms |
| 498 | 60 s | slim | 3.25 | 8.1 | 12.1 MB | 16 | 38 ms |

AXE off, no subscriptions (older run, 30 s, full): 250 clients → 2.1k deliveries/s, 5% core; 500 → 8.3k/s, 12%; 1000 →
33k/s, 21–25%; 2000 → 133k/s, 65%, 81 MB/s egress. Per client that is about 10 KB/s at 500 clients and 40 KB/s at 2,000, whatever the room size.

## Budgets used (assumptions — change them if your targets differ)

Bandwidth *capacity* is not the constraint: 10 KB/s is 80 kbit/s, far below any cellular or WiFi link. What matters is
(a) data plans, (b) battery (a message every 60 ms keeps the radio awake), (c) the relay's uplink and CPU.

| | Steady receive | Join download |
|---|---:|---:|
| Cellular | ≤ 3 KB/s (~65 MB/day at 6 h active) and ≤ 8 msgs/s | ≤ 3 MB |
| WiFi / desktop | ≤ 15 KB/s | ≤ 15 MB |

## Recommendation

- Room capacity **498 with a 30 s full heartbeat fails the cellular budget** (10.4 KB/s, 16.5 msgs/s, 12.6 MB join) and needs
  AXE plus spread-out joins to survive at all.
- Suggested set: **capacity 200, heartbeat 60 s (TTL stays 180 s = 3 beats), slim heartbeats (keys only on the join beat)**.
  Computed from the measured message sizes: 200 / 60 × 0.40 KB ≈ **1.3 KB/s and 3.3 msgs/s** per client, join ≈ 3.5 MB.
  Not measured as a combination.
- Keeping 498 is only reasonable for WiFi/desktop-only rooms, and only with 60 s slim heartbeats (3.25 KB/s measured) plus
  a lighter join (roster from the server's `/members` index instead of one Gun subscription per member — not measured).
- Turn AXE on for the production hub only after running the E2E suite against an AXE hub; stagger client roster
  subscription on join (random jitter) so a crowd arriving together does not stampede the relay.
- Plan for multiple relays: a single relay process is not the place to serve thousands of connected users.
