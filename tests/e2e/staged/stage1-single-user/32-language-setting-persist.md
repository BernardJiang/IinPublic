# 32: Language settings persist across page reload

covers: SPEC-3.2, SPEC-5.4  <!-- auto-seeded; refine by hand -->

Verify that UI language selection persists after `page.reload()`.
Switches UI language from English to Chinese, verifies translated UI labels appear,
reloads, and confirms the Chinese language setting is still active.
Then switches back to English and reloads to verify English persists.
