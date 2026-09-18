const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadTechSupportPairSync } = require('../src/server/security/techsupport-key-custody');

const ROOT = path.join(__dirname, '..');
const DIST_GREETING_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-greeting.js');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');
const OUTPUT_PATH = path.join(ROOT, 'src', 'shared', 'techsupport-onboarding-tips.signed.json');

/**
 * One-off build/dev step (docs/TODO.md K2, extended): signs the compiled "getting started" tips
 * for every locale with the TechSupport DM key, and commits the result as
 * `src/shared/techsupport-onboarding-tips.signed.json`. Modelled line-for-line on
 * `sign-techsupport-greeting.js` — re-run this script (and commit the new output) whenever the
 * tips copy or the DM key changes.
 *
 * Requires the encrypted TECHSUPPORT_KEY_FILE vault (preferred) or the legacy plaintext setting.
 */
function requireCompiled() {
  try {
    return {
      greeting: require(DIST_GREETING_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  } catch (err) {
    console.log('[sign-techsupport-onboarding-tips] dist/server/shared missing -- running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return {
      greeting: require(DIST_GREETING_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  }
}

async function main() {
  const pair = loadTechSupportPairSync();

  const { greeting, techsupport } = requireCompiled();
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `Configured TechSupport key pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to sign with the wrong key.`,
    );
  }

  const locales = Object.keys(greeting.TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES);
  const tipBundles = [];
  for (const locale of locales) {
    tipBundles.push(await greeting.signOnboardingTips(locale, pair));
  }

  const bundle = { version: 1, locales: tipBundles };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + '\n');
  console.log(`[sign-techsupport-onboarding-tips] wrote ${OUTPUT_PATH} (${locales.join(', ')})`);
}

main().catch((err) => {
  console.error('[sign-techsupport-onboarding-tips] failed:', err);
  process.exitCode = 1;
});
