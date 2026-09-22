const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadTechSupportPairSync } = require('../src/server/security/techsupport-key-custody');

const ROOT = path.join(__dirname, '..');
const DIST_FAQ_SEED_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-faq-seed.js');
const DIST_FAQ_BUNDLE_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-faq-bundle.js');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');
const OUTPUT_PATH = path.join(ROOT, 'src', 'shared', 'techsupport-faq-seed.signed.json');

/**
 * One-off build/dev step (docs/TODO.md K5, extending K2's compiled-content pattern): signs the
 * curated starter FAQ (`techsupport-faq-seed.ts`) as a real `SignedFaqBundle`, with the
 * TechSupport DM key, and commits the result as `src/shared/techsupport-faq-seed.signed.json`.
 * The client imports that file directly and verifies it with the exact same `verifyFaqBundle`
 * the live, organically-grown bundle uses — it works even if the TechSupport device has never
 * come online. Mirrors `sign-techsupport-greeting.js` / `sign-techsupport-onboarding-tips.js` —
 * re-run this script (and commit the new output) whenever the seed copy or the DM key changes.
 *
 * Requires the encrypted TECHSUPPORT_KEY_FILE vault (preferred) or the legacy
 * TECHSUPPORT_SEA_PAIR_JSON setting.
 */
function requireCompiled() {
  try {
    return {
      faqSeed: require(DIST_FAQ_SEED_MODULE),
      faqBundle: require(DIST_FAQ_BUNDLE_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  } catch (err) {
    console.log('[sign-techsupport-faq-seed] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return {
      faqSeed: require(DIST_FAQ_SEED_MODULE),
      faqBundle: require(DIST_FAQ_BUNDLE_MODULE),
      techsupport: require(DIST_TECHSUPPORT_MODULE),
    };
  }
}

async function main() {
  const pair = loadTechSupportPairSync();

  const { faqSeed, faqBundle, techsupport } = requireCompiled();
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `Configured TechSupport key pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to sign with the wrong key.`,
    );
  }

  const entries = faqSeed.buildSeedFaqEntries(new Date().toISOString());
  const signed = await faqBundle.signFaqBundle(entries, pair);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(signed, null, 2) + '\n');
  console.log(`[sign-techsupport-faq-seed] wrote ${OUTPUT_PATH} (${entries.length} entries)`);
}

main().catch((err) => {
  console.error('[sign-techsupport-faq-seed] failed:', err);
  process.exitCode = 1;
});
