const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function killListenersOnPort(port) {
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    console.log(`Stopped processes on port ${port}`);
  } catch {
    /* nothing listening */
  }
}

async function clearRunningServerGun() {
  try {
    const res = await fetch('http://localhost:8080/api/test/clear-database', { method: 'POST' });
    if (res.ok) {
      console.log('Cleared in-memory Gun graph on running dev server (port 8080)');
    }
  } catch {
    /* server not up yet — fresh start after radata wipe is enough */
  }
}

// Stop stale webpack/Gun from a previous dev or e2e run (common cause of phantom headcounts).
killListenersOnPort(3001);
killListenersOnPort(8080);

const root = path.resolve(__dirname, '..');
const names = fs.readdirSync(root);
const targets = names.filter((name) => {
  return (
    name === 'radata' ||
    /^radata_w\d+$/.test(name) ||
    name === 'data.json' ||
    name === 'data.json.tmp'
  );
});

for (const name of targets) {
  const target = path.join(root, name);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${name}`);
}

if (targets.length === 0) {
  console.log('No persisted dev Gun data found.');
}

void clearRunningServerGun();
