# React DOM evaluation — 2026-09-13

## Decision

Keep the framework-free DOM UI. Do not add React DOM to the production dependency graph.

The measured route editor is not a performance bottleneck: with 100 questions and 300 answers it
mounts in 21–35 ms and applies a direct input update in 0.1–0.3 ms. The bounded React pilot had
clean ownership, accessibility, and interaction results, but added 200,734 bytes (62,260 gzip) and
its end-to-end mount took 240–370 ms on the same machine/profiles. React's profiled component work
was efficient (9.6–11.6 ms mount and 0.2 ms p95 updates), but it did not offset the runtime,
reconciliation, DOM-commit, and migration costs for an editor whose ownership and tests are already
isolated.

React Native remains a separate product decision. It would replace presentation and bridge work
rather than address the measured identity/Gun synchronization and Contacts bottlenecks, so this
evaluation does not authorize or fund it.

## Method

`npm run profile:ui` builds ordinary production web/server assets and a packaged Electron app,
then records startup and interaction data from fresh profiles. Measurements ran on an Apple Silicon
macOS host with Node v26.4.0 and Playwright Chromium 143. The three targets were desktop Chromium
(1280×900), Chromium's Pixel 5 Android device profile (393×727), and the packaged Electron app.
The workload contains 500 Talks, 500 Contacts, and a 100-question/300-answer route editor.

The retained raw traces are:

- `ui-release-profile-baseline.json` — release baseline before deferred Contacts enrichment.
- `ui-release-profile-after.json` — paired release result after the optimization.
- `ui-release-profile-repeat.json` — confirmation run showing scheduler variance in the
  progressively rendered Talks completion time while its first chunk/input/scroll stayed stable.
- `react-route-editor-pilot.json` — the isolated React 19.1.1 profiling-build experiment.

The browser/mobile-profile samples use a local release server and report an artificial host-process
timestamp only to put phases on one timeline. Electron reports the real process and embedded-node
timestamps. The Android native shell now forwards real Activity-launch and node-health timestamps;
a real-device trace may be added later without changing this decision because the required Android
device/profile measurement is present here.

## Release startup and payload

| Target | HTML | Bundle executed | First usable navigation | Initial sync complete |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 204.9 ms | 248.8 ms | 260.4 ms | 1,035.1 ms |
| Pixel 5 profile | 106.3 ms | 150.5 ms | 167.4 ms | 1,614.2 ms |
| Electron | 110.4 ms DCL | 270.7 ms | 283.8 ms | 1,939.0 ms |

Electron's embedded Node health endpoint became ready at 112 ms. The baseline exposed two native
instrumentation defects: its sandboxed preload attempted to require a JSON file, and its CSP
blocked the inline head marker. The implementation now passes version/timestamps as process
arguments and loads the head marker as a same-origin external script. The paired after-trace
records Node ready at 114 ms and the head marker at 219.3 ms; the enhanced packaged-app E2E test
also verifies that the URL and preload timestamps match. The baseline table uses Navigation
Timing's 110.4 ms DOMContentLoaded value for its otherwise-missing HTML mark.

The baseline main bundle is 1,478,181 bytes (376,925 gzip). The optimization/instrumentation build
is 1,478,409 bytes (376,995 gzip), a 228-byte/70-byte-gzip increase. A cold browser profile transfers
the main bundle; a warm profile reports zero transferred bundle bytes. Only `bundle.js` is requested
before first interaction. The separately emitted Helia chunk (1,135,250 bytes; 319,582 gzip) and
MapLibre chunks are not requested on startup.

## Bottlenecks and framework-independent result

The traces identify these top three constraints:

1. Initial identity/Gun synchronization is the largest cold-start interval. It consumes about
   775 ms after first navigation in desktop Chromium, 1,447 ms in the Pixel 5 profile, and 1,655 ms
   in Electron. A view framework cannot remove this network/identity work.
2. Contacts navigation/filtering was the largest repeatable interaction task. Before optimization,
   the first chunk took 121.6–149.4 ms and a filtered update took 116.3–136.3 ms. Those intervals
   align with the largest 108–157 ms long tasks.
3. Electron's 500-row Contacts scroll remains the clearest rendering hot spot: three of 60 sampled
   frames miss the 20 ms budget and p95 is about 67 ms. Progressive rendering improves entry to the
   view but is not list virtualization.

Stage-name and headshot self-healing used to start asynchronous work for every known peer during the
Contacts navigation click. It now waits until idle/after the first paint, considers only peers that
passed the current filters, and abandons stale render generations. Talks, Contacts, and Answers
already use `renderListProgressively`; Gun graph work already runs through `GunBridge`'s Worker;
chatroom member bursts are coalesced; and Helia/MapLibre remain first-use dynamic imports.

| Target | Contacts first chunk | Contacts input | Contacts full render | Total long tasks |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 123.6 → 91.0 ms (−26.4%) | 117.4 → 99.3 ms (−15.4%) | 200.2 → 182.3 ms | 285 → 234 ms |
| Pixel 5 profile | 121.6 → 73.9 ms (−39.2%) | 116.3 → 99.5 ms (−14.4%) | 180.2 → 171.3 ms | 333 → 265 ms |
| Electron | 149.4 → 106.7 ms (−28.6%) | 136.3 → 99.9 ms (−26.7%) | 255.7 → 231.1 ms | 536 → 438 ms |

Startup remained within run-to-run noise: first usable navigation changed from 260.4 to 248.1 ms,
167.4 to 169.7 ms, and 283.8 to 281.4 ms respectively. The confirmation profile reproduced the
Contacts first-chunk/input improvements. Talks full-completion varied widely between passes while
its first chunk (~24–33 ms), input (~30–33 ms), and scroll stayed stable, so no Talks conclusion is
drawn from that scheduler-sensitive completion value.

## Bounded React route-editor pilot

The temporary pilot gave React exclusive ownership of `#react-route-root`; the legacy shell only
passed data/events across the boundary. It retained services, Gun, storage, identity, cryptography,
and platform shells unchanged. A React profiling production bundle rendered the same
100-question/three-answer shape, then ran 20 edits plus add/edit/remove interaction cycles.

| Target | Existing DOM mount/update | React wall mount | React profiler mount / p95 update | React input commit |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 21.2 / 0.1 ms | 240.0 ms | 10.1 / 0.2 ms | 42.8 ms |
| Pixel 5 profile | 23.2 / 0.2 ms | 286.0 ms | 9.6 / 0.2 ms | 44.3 ms |
| Electron | 34.8 / 0.2 ms | 369.5 ms | 11.6 / 0.2 ms | 48.4 ms |

The existing-DOM update is synchronous and includes a forced layout; the React input figure waits
for its asynchronous commit plus two animation frames, so the two update columns are not identical
clocks. The cold bundle and wall-mount differences are directly comparable and materially regress.

The pilot's post-mount heap growth was 5.1–5.2 MiB. The whole-app DOM workload grew by 4.2–6.5 MiB,
which is not isolated enough to claim a framework memory win. All 1,600 pilot controls were named or
labelled, the route-editor landmark was present, all 20 edit cycles preserved state, add/remove
restored the original answer count, and the legacy sibling remained untouched. The pilot was only
105 source lines versus the production controller's 506, but deliberately omitted the production
editor's route-DAG, built-in question, validation, localization, and persistence behavior; that
line-count difference is therefore not evidence of a maintainability reduction.

## Gate result

React DOM is rejected for the current application. The pilot-only implementation and packages were
removed, no `react`/`react-dom` dependency was added, and the application is shipped with its
ordinary production build. The startup profiler, native-shell timestamps, cached-asset profiling
mode, and deferred Contacts enrichment remain because they improve or preserve the framework-free
implementation independently of that decision.
