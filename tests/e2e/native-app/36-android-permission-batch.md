# Test: Permissions are asked once, together, at first launch

**File:** 36-android-permission-batch.spec.ts
**Gate:** `E2E_REAL_ANDROID_PERMISSIONS=1` (debug build installed; clears the app's data)

## What this test does (in plain English)

1. Clears the app's data and any "don't ask again" flags, then opens the app the way a person
   does (no automation extras).
2. Answers every system dialog with Allow and counts them: 3 on Android 13+ (notifications,
   location, Nearby devices), 2 on Android 12 (location, Nearby devices), 1 before that (location
   also covers Wi-Fi Direct; Bluetooth is granted at install). Camera is never in the batch — it
   is asked on the first QR scan.
3. Restarts the app: no permission dialog appears.
4. Settings → App permissions shows notifications, location and Nearby devices as Allowed and the
   camera as Not allowed; its button opens the app's Android settings page.

## Why

Users saw "Allow IinPublic to … while using the app?" dialogs at unrelated moments (Nearby asked
from three places, once per session after a Deny). Now the app asks once and never again by itself;
Settings → App permissions is where to change an answer.
