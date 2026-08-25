# TODO — Cross-Platform Performance Baseline & React Evaluation

**Status:** Planned, not started. This document authorizes measurement and a bounded React DOM
pilot only after its gates are met; it does **not** authorize a whole-app rewrite or a React Native
migration.
**Written:** 2026-08-23 after reviewing the framework-free UI and current browser, Electron, Android
WebView, and embedded Node/Gun architecture.

## Decision to make

Decide with release-build evidence whether IinPublic should:

1. keep the framework-free DOM UI after targeted performance/architecture work;
2. migrate incrementally to React DOM while retaining the existing shared web bundle and native
   shells; or
3. separately fund a React Native/Expo product effort for native mobile UI.

Removing the old unused React dependencies in `2f0b7355` was correct. Reintroducing React later must
be an intentional architecture decision with an owned screen, measurable target, and maintained
dependency graph.

## Current architecture and constraints

- One DOM application is reused by browsers, Electron, and Android WebView.
- Android starts an embedded Node/Gun runtime, waits for its loopback health endpoint, and then
  loads the web application. First-run Node staging can dominate perceived startup independently
  of the UI framework.
- The current production `dist/web/bundle.js` is about 2.9 MB uncompressed. Large P2P/IPFS chunks
  exist separately, so initial-load and deferred-load costs must be measured rather than guessed.
- `UIManager` and `app.ts` are large mutable coordinators. React could improve ownership and state
  boundaries, but React cannot by itself fix Gun synchronization, IPFS loading, cryptography,
  embedded Node startup, or work that blocks the browser main thread.

## Option summary

### React DOM in the existing shells

Pros:

- Incremental adoption inside an existing page is officially supported.
- Components can replace manual `innerHTML`, selectors, and listener rebinding one owned subtree
  at a time.
- React DevTools/Profiler provide component render evidence; transitions and deferred values can
  separate urgent interaction from non-critical rendering.
- The same UI can continue to run in browser, Electron, Android WebView, and a future iOS WebView.

Cons:

- Adds runtime and bundle cost; a poor component/state design can create rerender storms.
- Does not provide list virtualization or background-thread execution automatically.
- Gun and other push sources need a coalesced, explicitly scoped external-store adapter.
- During migration, React and legacy code must never mutate the same DOM subtree.

### React Native / Expo

Pros:

- Native mobile controls, navigation, gestures, accessibility, and UI-thread behavior.
- Business logic can be shared while platform-specific files/adapters handle Android and iOS.
- Can be integrated into an existing native app screen-by-screen.

Cons:

- Not a drop-in replacement for React DOM. Current HTML, CSS, DOM tests, WebView bridge, and much
  UI automation would need replacement or adapters.
- Web and Electron would still need React DOM or a compatibility layer, increasing platform scope.
- Existing Android nearby-connectivity JavaScript bridge capabilities would need native modules.
- Does not remove embedded Node/Gun startup or network synchronization costs.

## Phase 0 — Define and measure “slow” (mandatory)

- [ ] Measure **release builds**, not development builds, on at least one browser, Electron, and
      representative Android device/profile.
- [ ] Split cold start into timestamps:
      1. process/activity launch;
      2. embedded Node health-ready where applicable;
      3. HTML loaded;
      4. main bundle downloaded/read, parsed, and executed;
      5. first usable navigation;
      6. initial identity/Gun synchronization complete.
- [ ] Record main-thread long tasks, memory, navigation latency, input latency, and scroll frame
      behavior for Talks and Contacts.
- [ ] Record bundle/chunk transfer and parse sizes, including cold and warm cache.
- [ ] Name the top three bottlenecks with traces. Do not select a framework before this evidence.

## Phase 1 — Framework-independent performance work

- [ ] Defer non-critical initialization and feature modules until their first use.
- [ ] Verify that large P2P/IPFS code is not part of the critical first-interaction path.
- [ ] Coalesce bursty Gun events and update only the affected UI region.
- [ ] Virtualize or progressively render genuinely large lists; avoid rebuilding complete lists for
      one-row changes.
- [ ] Move sustained CPU work off the renderer thread where practical.
- [ ] Repeat Phase 0 measurements and retain before/after traces.

## Phase 2 — Bounded React DOM pilot

- [ ] Begin only after the `UIManager` route-editor cluster has explicit ownership and
      characterization tests.
- [ ] Use the route editor as the maintainability pilot because it is cohesive and interactive.
      If the goal is specifically list-speed, use the single slowest measured list instead; do not
      silently change the pilot goal.
- [ ] Give React exclusive ownership of one root element. Legacy code may pass typed data/events
      across the boundary but may not mutate descendants of that root.
- [ ] Keep services, Gun, storage, identity, cryptography, and platform shells unchanged.
- [ ] Record dependency/bundle delta, mount/update timings, input latency, memory, accessibility,
      E2E stability, and implementation effort.
- [ ] Use production profiling builds only for controlled measurements; ship an ordinary production
      build after the experiment.

## Phase 3 — Decision gate

- [ ] Compare the React pilot with the characterized DOM implementation using the same data and
      device/profile.
- [ ] Adopt incremental React DOM only if it improves maintainability without a material regression
      in cold start, interaction latency, memory, accessibility, or test reliability.
- [ ] If adopted, migrate one screen/cluster per commit with exclusive DOM ownership and a green
      canonical gate. Do not combine migration with behavior redesign.
- [ ] If rejected, remove pilot-only dependencies/configuration and retain the measured
      framework-independent improvements.

## Separate React Native gate

React Native requires a new owner decision and budget. Approve it only if native mobile experience
is a product requirement strong enough to justify separate web/desktop presentation work, native
bridge replacement, new build/release pipelines, and a staged migration plan. It must not be chosen
as a presumed cure for unmeasured slowness.

## Primary references

- React: [Add React to an Existing Project](https://react.dev/learn/add-react-to-an-existing-project)
- React: [`<Profiler>`](https://react.dev/reference/react/Profiler)
- React Native: [Performance Overview](https://reactnative.dev/docs/performance.html)
- React Native: [Integration with Existing Apps](https://reactnative.dev/docs/integration-with-existing-apps.html)
- React Native: [Platform-Specific Code](https://reactnative.dev/docs/platform-specific-code.html)
- Electron: [Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
