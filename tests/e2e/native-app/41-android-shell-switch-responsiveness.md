# 41 — Android shell-switch responsiveness
covers: SPEC-5.1, SPEC-5.4, SPEC-6.5, SPEC-13.1

Immediately after a physical Android launch, all five bottom tabs and the active top app-bar
actions must switch within their responsiveness budget. This guards against foreground-recovery
work queues making the touch UI appear frozen.

Run under the native-app Playwright configuration with the configured Android phone connected.
