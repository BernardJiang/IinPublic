// Minimal, locked-down preload. The web SPA is reused unchanged and already
// talks to the local node over loopback HTTP/WebSocket, so it needs no Node
// access. We only expose a tiny, read-only surface for the shell to advertise
// that it is the native host (e.g. to hide "install desktop app" prompts).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('iinpublicNative', {
  platform: process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' ? 'ubuntu'
    : process.platform === 'darwin' ? 'macos' : 'unknown',
  shell: 'electron',
  embeddedNode: true,
});
