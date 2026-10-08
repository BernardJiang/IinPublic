# Test: Real cellular phone ↔ Wi-Fi phone through the public hub

**File:** 29-android-cellular-talk-exchange.spec.ts
**Gate:** `E2E_REAL_ANDROID_CELLULAR=1`, `NATIVE_APP_ANDROID_CELLULAR=<serial with SIM>`, `NATIVE_APP_ANDROID_WIFI_PEER=<serial>`
**Hub:** `NATIVE_APP_CELLULAR_HUB` (default `https://www.iinpublic.com/gun` — production)

## What this test does (in plain English)

1. Wakes both phones, turns Wi-Fi OFF on the SIM phone and confirms its default network is cellular.
2. Resets both apps and boots them against the public hub; pings the hub from the SIM phone's shell.
3. Both phones join a private, run-unique room (never Global — this runs against production).
4. The Wi-Fi phone authors and broadcasts a tag Talk; the cellular phone must receive it.
5. The cellular phone authors and broadcasts a tag Talk; the Wi-Fi phone must receive it.
6. The cellular phone answers the Wi-Fi phone's Talk with a match; both phones must get the conversation.
7. Each phone sends a DM; the other must see it (direct P2P transport across carrier NAT).
8. `afterAll` turns Wi-Fi back on.

## First run (2026-10-07, 1.0.120)

HONOR FCP-AN10 on Mint/T-Mobile LTE ↔ PH-1 on Wi-Fi: Talks ~450 ms each way, match ~570 ms,
DMs ~5 s each way. 1 passed (1.5 m).
