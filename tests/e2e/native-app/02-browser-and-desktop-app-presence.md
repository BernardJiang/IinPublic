# 02-browser-and-desktop-app-presence

This suite verifies that a Chromium user and the real macOS Electron app join the same Global
chatroom through the shared hub, observe each other, and can exchange direct messages.

It also verifies durable chatroom leave behavior. After both peers join, the desktop app leaves
through the production chatroom service. The hub's active-member API and the browser's rendered
roster must both remove the desktop user, while the underlying Gun membership record retains
`isActive: false` and a durable `leftAt` timestamp.

Covers: SPEC-5.5.
