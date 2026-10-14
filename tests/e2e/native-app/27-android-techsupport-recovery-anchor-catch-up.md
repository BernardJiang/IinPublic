# 27 — Android: TechSupport recovery anchor stale-cache catch-up (OPEN-29)

Real phone, debug build, app data kept. The phone learns recovery records through its embedded
node's `GET /api/support/recovery` (relayed to the hub, polled by `app.ts` every 5 s) or through Gun
sync with the hub, whichever lands first.

1. Seed the WebView cache `iinpublic_techsupport_recovery_anchor_v1` with an hour-older record,
   then publish a "now" record to the hub. The phone's cache must reach the hub record within 60 s.
2. Seed an hour-NEWER record. It must survive 15 s of relay polls and a force-stop relaunch.

Signs with the cold-storage vault (`TECHSUPPORT_RECOVERY_KEY_FILE` + `TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE`)
or the legacy `TECHSUPPORT_RECOVERY_SEA_PAIR_JSON` (skips without either). Posted
records revoke nothing; the cache key is removed afterwards.

Run: `set -a; . ./.env.local; set +a; NATIVE_APP_ANDROID_SERIAL=<serial> npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/27-android-techsupport-recovery-anchor-catch-up.spec.ts`
