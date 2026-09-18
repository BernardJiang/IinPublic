import fs from 'fs';
import path from 'path';
import { loadRealTechSupportPair } from '../support/techsupport-real-pair';

/**
 * K3 (docs/TODO.md) — the single biggest risk flagged in the design note: the TechSupport DM
 * private key must reach the browser ONLY via the `dev:techsupport` launcher's
 * localStorage-injection channel, never through the webpack bundle. Wiring
 * `TECHSUPPORT_SEA_PAIR_JSON` into webpack's `EnvironmentPlugin` (the mechanism that inlines
 * `IINPUBLIC_STAGE_SEED`) would ship the private key in every public bundle and let anyone
 * forge messages as TechSupport — a total defeat of the K2/K3 signing model.
 *
 * Scans the built web bundle (`npm run build:web`) for private-key material and all custody env-var
 * names. The name checks always run; only the secret-value checks are skipped when this machine
 * has no legacy real pair loaded. Deliberately never hardcodes the private-key halves it checks
 * for; that would recommit the exact leak this test exists to prevent.
 */
describe('TechSupport DM private key is never bundled into the web client (docs/TODO.md K3)', () => {
  const distWebDir = path.join(__dirname, '..', '..', '..', 'dist', 'web');

  function bundleJsFiles(): string[] {
    if (!fs.existsSync(distWebDir)) return [];
    return fs
      .readdirSync(distWebDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(distWebDir, name));
  }

  it('contains neither the private key halves nor the env-var name in any built bundle file', () => {
    const files = bundleJsFiles();
    if (files.length === 0) {
      console.warn('[techsupport-key-not-bundled] dist/web not built in this checkout — skipping (run `npm run build:web` to exercise this guard).');
      return;
    }
    const pair = loadRealTechSupportPair();
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8');
      expect(contents).not.toContain('TECHSUPPORT_SEA_PAIR_JSON');
      expect(contents).not.toContain('TECHSUPPORT_KEY_FILE');
      expect(contents).not.toContain('TECHSUPPORT_KEY_PASSPHRASE');
      if (pair) {
        expect(contents.includes(pair.priv)).toBe(false);
        expect(contents.includes(pair.epriv)).toBe(false);
      }
    }
  });
});
