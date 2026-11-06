covers: SPEC-3.1, SPEC-5.3, SPEC-5.5, SPEC-29.3, SPEC-31.3

# Password-free custody across a browser restart

A persistent Chromium, WebKit, or Firefox profile is closed completely and reopened. The same SEA
identity survives, protected by a non-extractable AES-GCM WebCrypto key; the wrapping key cannot be
exported and the legacy v1 custody record is absent.
