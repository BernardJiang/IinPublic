# 32 — Android protocol-manifest upgrade
covers: SPEC-5.3, SPEC-19.13

Two physical phones run deliberately different protocol histories. The older phone blocks ordinary
Talk exchange until it verifies the signed manifest suffix, persists the accepted checkpoint and
archive, exchanges in both directions, and retains the upgrade after restart.

Run with `E2E_REAL_ANDROID_PROTOCOL_MANIFEST=1`, two designated phones, and both APK paths.
