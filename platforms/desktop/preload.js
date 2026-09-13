// Minimal, locked-down preload. The web SPA is reused unchanged and already
// talks to the local node over loopback HTTP/WebSocket, so it needs no Node
// access. We only expose a tiny, read-only surface for the shell to advertise
// that it is the native host (e.g. to hide "install desktop app" prompts).
const { contextBridge } = require('electron');

function finiteEpoch(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

contextBridge.exposeInMainWorld('iinpublicNative', {
  platform: process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' ? 'ubuntu'
    : process.platform === 'darwin' ? 'macos' : 'unknown',
  shell: 'electron',
  embeddedNode: true,
  version: argumentValue('iinpublic-app-version'),
  startup: {
    processLaunchEpochMs: finiteEpoch(
      argumentValue('iinpublic-process-launch-ms') || process.env.IINPUBLIC_PROCESS_LAUNCH_EPOCH_MS,
    ),
    nodeHealthReadyEpochMs: finiteEpoch(
      argumentValue('iinpublic-node-health-ready-ms') || process.env.IINPUBLIC_NODE_HEALTH_READY_EPOCH_MS,
    ),
  },
});
