# Cross-platform matrix hosts and devices

`devices.json` maps physical Android serials to stable logical names.
`hosts.json` defines remote desktop workers. Keep scenarios independent of raw SSH hosts
and filesystem paths; platform runners resolve those details here.

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
