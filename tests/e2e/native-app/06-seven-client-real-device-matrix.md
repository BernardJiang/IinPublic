# 06 — Seven-client real-device matrix
covers: SPEC-3.4, SPEC-5.5, SPEC-19.4

Opt-in physical-runtime coverage for browsers, the packaged macOS app, and every configured
Android phone that is connected. The available clients share presence, exchange matching Talks,
and prove that unavailable hardware is reported as skipped instead of aborting the matrix.

Run with `E2E_REAL_DEVICE_MATRIX=1` under the native-app Playwright configuration.
