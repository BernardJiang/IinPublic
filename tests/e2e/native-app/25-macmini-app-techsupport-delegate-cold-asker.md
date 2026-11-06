# 25 — Cold packaged-app asker reaches a TechSupport delegate
covers: SPEC-5.5, SPEC-19.7

A newly booted packaged macOS app asks TechSupport before it has a pre-synced delegate roster.
The signed question must reach an opted-in browser delegate, guarding the embedded-node origin and
public-key lookup path that browser-only coverage cannot reproduce.

Run with a packaged desktop build and the local TechSupport signing key configured.
