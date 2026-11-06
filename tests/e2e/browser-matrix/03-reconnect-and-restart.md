covers: SPEC-5.2, SPEC-5.5, SPEC-8.1, SPEC-19.4

# Mixed-browser reconnect and restart

Chromium and WebKit form a matched conversation. WebKit sends while Chromium is offline; the
message converges after reconnect. Chromium then reloads with the same persistent profile and
retains its identity, conversation, and history.
