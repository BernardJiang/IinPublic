# 18 — Android Keystore identity custody
covers: SPEC-5.3, SPEC-19.13

On each connected physical Android test phone, a fresh identity is wrapped by an AES-256-GCM key
held in Android Keystore. The journey checks ciphertext-only app storage, restart and v1-migration
continuity, fail-closed conflict handling, erase, and reinstall identity reset.

Run under the native-app Playwright configuration with the target Android device(s) connected.
