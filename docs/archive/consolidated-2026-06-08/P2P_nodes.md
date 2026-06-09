# P2P Nodes Conversation Notes

## Scope

This document consolidates the discussion about:

- recent flaky test fixes,
- `E2E_GUN_MEMORY_ONLY=1`,
- Gun synchronization across server and clients,
- data scope for 10k+ users,
- feasibility and impact of per-user node architecture,
- local simulation on a single machine.

## Last 3 Commits Reviewed

### `fb5b7ec` - Fix spec-12 flake

- Root issue: E2E test conversation checks relied on Gun graph reads that were unreliable in memory-only mode.
- Fix: add server-side `conversationsMap` as authoritative in-memory source for test endpoint reads.
- Update test-side polling to read that endpoint more reliably.

### `e903ead` - Disk race + age-verify write-path fix + E2E coverage

- Remove unnecessary disk cleanup and sleeps in E2E clear flow because E2E servers run memory-only Gun.
- Fix `vouchAgeVerified` write path so age verification is persisted where delivery context reads it.
- Add age-gating E2E coverage.

### `2f82754` - New unblock E2E test

- Add P0 coverage proving talk delivery resumes after unblock.
- This is a coverage addition, not the main flaky-test root-cause fix.

## What `E2E_GUN_MEMORY_ONLY=1` Means

In this project, when `E2E_GUN_MEMORY_ONLY=1` is set:

- server Gun runs with `radisk: false` (no disk persistence),
- server uses isolated memory-only graph behavior for deterministic tests,
- Playwright workers each run their own server pair on offset ports.

Result: each worker has its own isolated in-memory Gun state; workers do not share graph state.

## How Sync Works in Real Environment

With one normal server and two remote browsers:

- both browsers peer to the same Gun relay endpoint (`/gun` on server origin),
- each browser sends updates to server relay,
- relay merges/forwards updates to subscribed peers,
- each browser keeps only the subset it subscribes to/uses.

The server is the shared relay and persistence point in current architecture.

## If Server Goes Down

With current single-relay topology:

- live cross-user synchronization stops,
- each client may still have local cached data,
- no ongoing peer-to-peer sync unless additional peer/relay topology is added.

## 10k+ Users: Who Stores What?

- **Server:** tends to accumulate all Gun data written through that relay (normal mode with persistence).
- **Client:** generally syncs only paths it reads/subscribes to, not the entire global graph.
- App architecture further scopes important user views (for example, incoming talk views via user-scoped API paths).

## Per-User Nodes Architecture: Change Size

Making each user a node/server and using central server only for discovery is a major change.

Expected impact:

- networking model redesign (discovery, peer setup, reconnect/retry),
- security/trust model updates,
- offline queueing/store-forward design,
- new reliability and operational burden,
- significant E2E and deployment rework.

This is a multi-phase, high-risk architectural program, not a small refactor.
Big change. Think major architecture shift, not a tweak.

If you want “original server only for discovery, then users talk peer-to-peer (each user runs their own node),” that’s closer to a new networking model with the current app logic reused selectively.

Rough size estimate
Effort: large (multi-week to multi-month depending on reliability/security goals).
Risk: high (NAT/firewall, auth, abuse, offline behavior, message durability).
Code impact: server bootstrap/networking, client bootstrap, identity/trust, delivery routes, test harness, and deployment model all change.
What must change
Discovery service split

Keep central server for: identity, peer directory, signaling/bootstrap only.
Remove it from being the authoritative talk-delivery path.
Per-user node runtime

Each user needs a reachable node (desktop app, local daemon, or hosted personal agent).
Browser alone is not reliably reachable behind NAT; usually you need WebRTC + TURN or a hosted relay fallback.
Transport redesign

Today clients mostly sync through one /gun relay + REST.
New model needs peer session setup, reconnect, retries, peer health, version compatibility.
Data ownership model

Decide what is replicated globally vs only on participant nodes.
Conflict resolution, eventual consistency, and retention policies must be explicit.
Security/trust

Strong peer auth (who is this node?), message signing, encryption, replay protection, abuse controls.
Revocation/blocking becomes distributed, not just server-enforced route logic.
Durability

If user node is offline, where do messages/talks queue?
You likely need inbox relays/store-and-forward nodes anyway (which reintroduces server responsibilities).
Testing + operations

E2E becomes much harder: multi-node orchestration, NAT simulation, flaky network conditions, churn.
Support burden increases a lot.
Practical takeaway
If goal is mainly reduce central server load/storage, do an intermediate design first:
Keep server authoritative for critical flows.
Move heavy/optional data to peer sync progressively.
Add TTL/archival/sharding on server storage.
Introduce relay federation before true per-user nodes.
That path is much safer than a full “every user is a server” jump.

If you want, I can sketch a concrete 3-phase migration plan mapped to your current code structure (http-bootstrap, delivery routes, WebGunService, E2E helpers) so you can estimate timeline and risk per phase.


## Can Per-User Nodes Be Simulated on One Machine?

Yes.

Recommended first step:

- run one discovery process + multiple user-node processes on different ports,
- attach separate browser sessions per simulated user node,
- validate protocol correctness and replication logic locally.

Limitations of single-machine simulation:

- does not fully validate NAT/firewall traversal,
- does not fully reflect WAN latency/jitter/mobile lifecycle behavior.

## Practical Migration Guidance

Preferred path:

1. local multi-process simulation,
2. multi-network testbed validation,
3. small controlled pilot.

This de-risks the transition from relay-centric architecture to per-user node topology.
