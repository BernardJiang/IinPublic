# 86-download-app-settings

covers: SPEC-27, SPEC-26.2

Settings → "Download the app" plus the app-download banner's rewording. IinPublic ships real
native Mac/Windows/Android apps, so neither the banner nor the Settings section says "not
available"/"network" anymore — a platform with no published build shows "Coming soon", and the
banner's fallback links straight into the Settings section instead of dead-ending. This env
publishes no download URLs, so every platform is deterministically "Coming soon": the Settings
section lists all three platforms, and the banner's "See download options" action drills into it.
