# Cross-platform matrix hosts and devices

`devices.json` maps physical Android serials to stable logical names.
`hosts.json` defines remote desktop workers. Keep scenarios independent of raw SSH hosts
and filesystem paths; platform runners resolve those details here.

## Central runner and report collector

```bash
npm run test:matrix -- browsers
npm run test:matrix -- android
npm run test:matrix -- desktop
npm run test:matrix -- discovery
npm run test:matrix -- --alice macos-app --bob firefox
npm run test:matrix -- --all
```

Add `--dry-run` to validate selection, lifecycle wiring, and reporting without starting tests.
All profiles share `prepare`, `install`, `reset`, `start`, `stop`, scenario-action, log,
screenshot, and status operations. Android/Windows/Ubuntu profiles perform their availability
gate first and skip unavailable hardware without starting installation, builds, or tests.
Results are collected on the Mac under ignored `test-results/matrix/<run-id>/`, with per-scenario
JSON/Markdown, peer logs, screenshots, topology/identity metadata, duration, grouped platform
status, and structured failure diagnostics.

## macOS Firefox

```bash
npm run test:e2e:macos-firefox:preflight
npm run test:e2e:macos-firefox
npm run test:e2e:macos-firefox:native
```

The macOS runner checks the configured Firefox executable and launches a short WebDriver BiDi
probe before it builds or starts any test server. An unavailable optional browser is reported as
`SKIP` and starts no tests; set `MACOS_FIREFOX_REQUIRED=1` to make that condition fail CI.
`MACOS_FIREFOX_EXECUTABLE` overrides the configured application path.

The `macos-firefox` project runs the platform smoke gate in the installed stable Firefox release,
and `macos-firefox-mixed` runs its Chromium ↔ Firefox and Firefox ↔ WebKit matched-thread cases.
They are distinct from the existing `firefox` project, which uses Playwright's bundled Firefox
build. The `:native` command reuses the same preflight, launches the local Electron app with an
isolated profile, and verifies presence plus a bidirectional direct-P2P conversation between the
installed Firefox release and the macOS app.

## Windows worker

```bash
npm run test:e2e:windows:preflight
npm run test:e2e:windows
npm run test:e2e:windows:desktop
```

The Windows runner always performs its SSH/OS preflight before creating an archive,
installing dependencies, building, or starting Playwright. An unavailable optional worker
is reported as `SKIP` and starts no tests; set `WINDOWS_E2E_REQUIRED=1` to make that condition
fail CI. `WINDOWS_E2E_SSH_HOST` overrides the configured `windows-test` alias.

The runner installs portable Node under the remote user's `iinpublic-tools` directory and
deploys the exact local Git revision to a revision-keyed worker directory. The browser mode
runs Chromium, installed Microsoft Edge, WebKit, and Firefox. Desktop mode builds the x64
NSIS installer, installs it into an isolated directory, launches the installed `IinPublic.exe`
with an isolated profile, verifies the embedded HTTP service and SPA, closes it, and runs the
silent uninstaller. Both modes copy Playwright's blob report back to the Mac and merge it into
`playwright-report/`. The browser mode also runs a simultaneous Edge-to-Firefox matching and
bidirectional-message scenario. Desktop reports retain Electron's file log and attach up to ten
Crashpad artifacts when present. A lockfile hash stamp allows safe dependency reuse only within
the exact same revision workspace.

## Ubuntu worker

```bash
npm run test:e2e:ubuntu:preflight
npm run test:e2e:ubuntu:chromium
npm run test:e2e:ubuntu:firefox
npm run test:e2e:ubuntu:desktop
```

The Ubuntu runner checks `ubuntu-test` availability, verifies the remote OS/architecture and an
accessible X11 desktop, and checks free space before it deploys or starts a test. An unavailable
optional worker reports `SKIP`; set `UBUNTU_E2E_REQUIRED=1` to fail instead.
`UBUNTU_E2E_SSH_HOST` and `UBUNTU_E2E_DISPLAY` override the configured alias and display.

The runner installs portable Node in the remote user's home, deploys the exact controller Git
revision into an isolated workspace. The `:chromium` and `:firefox` modes give the matching
Playwright browser installation a five-minute timeout, build the embedded app, and run the
platform-smoke gate on the existing Ubuntu desktop session. The `:desktop` mode builds the Linux
x64 AppImage, extracts it without root or FUSE, and launches that packaged executable with an
isolated profile through Playwright Electron. Blob reports and desktop diagnostics are copied back
and merged into the Mac's `playwright-report/`. Generated package/staging output is removed
afterward; on a new Git revision the runner prunes only prior revision directories bearing its
private ownership marker, which keeps the small worker disk reusable without touching other files.
