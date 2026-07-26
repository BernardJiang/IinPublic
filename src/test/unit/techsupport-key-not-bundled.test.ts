import fs from 'fs';
import path from 'path';

/**
 * K3 (docs/TODO.md) — the single biggest risk flagged in the design note: the TechSupport DM
 * private key must reach the browser ONLY via the `dev:techsupport` launcher's
 * localStorage-injection channel, never through the webpack bundle. Wiring
 * `TECHSUPPORT_SEA_PAIR_JSON` into webpack's `EnvironmentPlugin` (the mechanism that inlines
 * `IINPUBLIC_STAGE_SEED`) would ship the private key in every public bundle and let anyone
 * forge messages as TechSupport — a total defeat of the K2/K3 signing model.
 *
 * Scans the built web bundle (`npm run build:web`) for the private key material and the literal
 * env-var name. Skips gracefully if the bundle hasn't been built yet in this checkout — this is
 * a regression guard on the build output, not a test of application logic, so it cannot invent
 * a bundle that doesn't exist.
 */
describe('TechSupport DM private key is never bundled into the web client (docs/TODO.md K3)', () => {
  const distWebDir = path.join(__dirname, '..', '..', '..', 'dist', 'web');
  const devPrivateHalves = [
    'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo', // priv
    'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4', // epriv
  ];

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
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8');
      expect(contents).not.toContain('TECHSUPPORT_SEA_PAIR_JSON');
      for (const half of devPrivateHalves) {
        expect(contents.includes(half)).toBe(false);
      }
    }
  });
});
