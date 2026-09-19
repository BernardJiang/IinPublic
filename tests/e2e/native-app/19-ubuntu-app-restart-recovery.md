# 19 — Ubuntu app restart recovery (OPEN-11)

The packaged Ubuntu Electron app (over SSH+CDP) and the macOS Electron app share a LAN hub. The
Ubuntu app process is killed and relaunched on the same profile. Expected: identical user id,
Global membership restored, and a Talk broadcast by macOS during the restart is completed by the
relaunched Ubuntu app.

Run: `E2E_REAL_UBUNTU_RESTART=1 npm run build:embedded && npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/19-ubuntu-app-restart-recovery.spec.ts`
