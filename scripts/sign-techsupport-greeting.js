const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_GREETING_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-greeting.js');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');
const OUTPUT_PATH = path.join(ROOT, 'src', 'shared', 'techsupport-greeting.signed.json');

/**
 * One-off build/dev step (docs/TODO.md K2): signs the compiled welcome-greeting template for
 * every locale with the TechSupport DM key, and commits the result as
 * `src/shared/techsupport-greeting.signed.json`. The client imports that file directly and
 * never fetches it from the relay — re-run this script (and commit the new output) whenever
 * the greeting copy or the DM key changes.
 *
 * Requires TECHSUPPORT_SEA_PAIR_JSON in the environment (see `.env.local`). Mirrors
 * `dev-techsupport-bootstrap.js`'s pattern of requiring the compiled `dist/server/shared`
 * output so the script can never sign a payload the client-side verifier disagrees with.
 */
function requireCompiled() {
  try {
    return {
      greeting: require(DIST_GREETING_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  } catch (err) {
    console.log('[sign-techsupport-greeting] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return {
      greeting: require(DIST_GREETING_MODULE),
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

  const { greeting, techsupport } = requireCompiled();
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `TECHSUPPORT_SEA_PAIR_JSON.pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to sign with the wrong key.`,
    );
  }

  const locales = Object.keys(greeting.TECHSUPPORT_GREETING_TEMPLATES);
  const greetings = [];
  for (const locale of locales) {
    greetings.push(await greeting.signGreeting(locale, pair));
  }

  const bundle = { version: 1, greetings };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + '\n');
  console.log(`[sign-techsupport-greeting] wrote ${OUTPUT_PATH} (${locales.join(', ')})`);
}

main().catch((err) => {
  console.error('[sign-techsupport-greeting] failed:', err);
  process.exitCode = 1;
});
