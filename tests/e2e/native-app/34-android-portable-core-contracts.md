covers: SPEC-10.3, SPEC-11.3, SPEC-27

# Android portable core contracts

The same deterministic core contracts and portable Jest cases execute inside the Android WebView
and the app's embedded Node runtime. Their case identifiers and results must match the host lane,
guarding the shared-logic/platform boundary on a real Android device.
