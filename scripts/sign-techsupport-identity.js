const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_ANNOUNCEMENTS_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'system-announcements.js');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');
const OUTPUT_PATH = path.join(ROOT, 'src', 'shared', 'techsupport-identity.signed.json');

/**
 * One-off build/dev step (docs/TODO.md K3): signs the TechSupport identity record once with the
 * **announcement** key (relay-held, K3-1 — not the DM/greeting key) and commits the result as
 * `src/shared/techsupport-identity.signed.json`. The server republishes this committed blob on
 * every boot and E2E reset (`TechSupportAnnouncementService.publishIdentity()`) without ever
 * holding the private key at boot time. Re-run and commit only on a key rotation.
 */
function requireCompiled() {
  try {
    return {
      announcements: require(DIST_ANNOUNCEMENTS_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  } catch (err) {
    console.log('[sign-techsupport-identity] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return {
      announcements: require(DIST_ANNOUNCEMENTS_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  }
}

async function main() {
  const raw = process.env.TECHSUPPORT_SEA_PAIR_JSON;
  if (!raw) {
    throw new Error('TECHSUPPORT_SEA_PAIR_JSON is not set (see .env.local).');
  }
  const pair = JSON.parse(raw);
  if (!pair.pub || !pair.priv) {
    throw new Error('TECHSUPPORT_SEA_PAIR_JSON is missing pub/priv.');
  }

  const { announcements, techsupport } = requireCompiled();
  const expectedPub = techsupport.currentTechSupportAnnouncementPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `TECHSUPPORT_SEA_PAIR_JSON.pub (${pair.pub}) does not match currentTechSupportAnnouncementPub() ` +
      `(${expectedPub}) — refusing to sign the identity record with the wrong key.`,
    );
  }

  const identity = await announcements.signTechSupportIdentity(pair);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(identity, null, 2) + '\n');
  console.log(`[sign-techsupport-identity] wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[sign-techsupport-identity] failed:', err);
  process.exitCode = 1;
});
