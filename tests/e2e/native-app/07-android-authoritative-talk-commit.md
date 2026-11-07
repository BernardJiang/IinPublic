# 07 — Android authoritative Talk commit

covers: SPEC-10.3, SPEC-31.9

Physical-device regression for the Talk Editor's authoritative commit boundary. A local
`myTalks` projection used to appear before the Gun repository write completed; this opt-in
test (E2E_REAL_ANDROID_TALK_COMMIT=1, real Android over adb) creates a tag talk via the
editor and requires the OUT row to appear only after its Gun repository record is readable in
the device graph.
