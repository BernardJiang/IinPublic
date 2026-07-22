# 00-platform-smoke

covers: SPEC-12.4

A compact, single-browser pass over the cross-platform-invariant surface: sweep
all five tabs with no horizontal clipping, reach the create-talk action inline or
via the ⋯ overflow, open and close a full-screen-takeover dialog (Talk Editor),
and verify a settings toggle survives a reload.

## Projects that run this spec (@smoke)

| Project | Engine | Viewport | How to run |
|---|---|---|---|
| `chromium` | Chromium | desktop | default (`npm run test:e2e:smoke`) |
| `webkit` | WebKit (Safari engine) | Desktop Safari | `npm run test:e2e:webkit` |
| `firefox` | Firefox | Desktop Firefox | `npm run test:e2e:cross-browser` (webkit + firefox) |
| `iphone-webkit` | WebKit | 390×844 | `npm run test:e2e:device-profiles` |
| `android-chromium` | Chromium | 360×800 | `npm run test:e2e:device-profiles` |

The `webkit`/`firefox` projects are the desktop cross-BROWSER gate (Chrome works
≠ Safari works): they exist to surface engine-specific breakage — storage/SEA
boot, WebRTC, layout — as a concrete Playwright failure instead of a vague
"doesn't work in Safari". One-time setup: `npx playwright install webkit firefox`.
Opt into a `test:all` run with `E2E_CROSS_BROWSER=1 npm run test:all`.

Playwright WebKit is the closest automatable proxy for Safari; a real-Safari
manual pass per release is still documented in `tests/e2e/cross-platform/README.md`.
