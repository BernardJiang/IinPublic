# Cross-platform matrix hosts and devices

`devices.json` maps physical Android serials to stable logical names.
`hosts.json` defines remote desktop workers. Keep scenarios independent of raw SSH hosts
and filesystem paths; platform runners resolve those details here.

## Windows worker

```bash
npm run test:e2e:windows:preflight
npm run test:e2e:windows
```

The Windows runner always performs its SSH/OS preflight before creating an archive,
installing dependencies, building, or starting Playwright. An unavailable optional worker
is reported as `SKIP` and starts no tests; set `WINDOWS_E2E_REQUIRED=1` to make that condition
fail CI. `WINDOWS_E2E_SSH_HOST` overrides the configured `windows-test` alias.

The runner installs portable Node under the remote user's `iinpublic-tools` directory,
deploys the exact local Git revision to a revision-keyed worker directory, runs the Chromium,
WebKit, and Firefox platform smoke projects, copies Playwright's blob report back to the Mac,
and merges it into `playwright-report/`.
