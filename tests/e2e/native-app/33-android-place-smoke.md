# 33 — Android release smoke: Places on two phones

Two real phones, fresh app data, pointed at a hub this spec starts on the Mac's LAN address with
the release capacity (never the public hub — Places there are public and undeletable). Phone 1
creates a Place; phone 2 finds it and enters; each sees the other; both go home; phone 2 still
sees the empty Place and enters it again.

Opt-in (`E2E_REAL_ANDROID_PLACE_SMOKE=1`) and destructive (clears app data on the two phones named
in `NATIVE_APP_ANDROID_SERIALS`). Part of `npm run test:android:release-smoke`.
