# 22 — macOS safeStorage identity custody
covers: SPEC-5.3, SPEC-5.5, SPEC-19.13

The packaged macOS application keeps its SEA identity in Electron safeStorage backed by the login
Keychain. The journey verifies ciphertext-only disk custody, no WebView plaintext copy, and the
same public identity after a full close and relaunch.

Run on macOS under the native-app Playwright configuration.
