# 23 — Live peer scenarios (Tier 5)

Parametrised all-pairs scenarios over real peers: local macOS app, installed Windows app, Ubuntu
AppImage, physical Android phones. Every peer authors + broadcasts a tag Talk; every other peer
completes it with a match.

`E2E_LIVE_SCENARIO=windows-android|mac-windows-android|windows-ubuntu|android-ubuntu|full npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/23-live-peer-scenarios.spec.ts`
