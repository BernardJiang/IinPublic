import fs from 'fs';
import path from 'path';
import {
  deriveBackendApiBaseFromLocation,
  deriveGunHubUrlFromLocation,
} from '../../web/services/web-gun-service';
import {
  EMBEDDED_NODE_DEFAULT_HUB,
  resolveEmbeddedNodeConfig,
} from '../../shared/embedded-node-config';
import { resolveUpstreamHubPeers, buildAllowedOrigin } from '../../server/bootstrap/http-bootstrap';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const generatedDirs = new Set([
  'assets',
  'build',
  'dist',
  'node_modules',
]);

function walkFiles(dir: string, extensions: Set<string>, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (generatedDirs.has(entry.name)) continue;
      walkFiles(full, extensions, out);
    } else if (extensions.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe('production/development topology contract', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.IINPUBLIC_ALLOWED_ORIGINS;
  const originalE2EMemoryOnly = process.env.E2E_GUN_MEMORY_ONLY;
  const originalTlsDisable = process.env.TLS_DISABLE;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowedOrigins === undefined) delete process.env.IINPUBLIC_ALLOWED_ORIGINS;
    else process.env.IINPUBLIC_ALLOWED_ORIGINS = originalAllowedOrigins;
    if (originalE2EMemoryOnly === undefined) delete process.env.E2E_GUN_MEMORY_ONLY;
    else process.env.E2E_GUN_MEMORY_ONLY = originalE2EMemoryOnly;
    if (originalTlsDisable === undefined) delete process.env.TLS_DISABLE;
    else process.env.TLS_DISABLE = originalTlsDisable;
  });

  it('keeps browser URL derivation compatible across production, LAN dev, and native loopback', () => {
    expect(deriveBackendApiBaseFromLocation('https:', 'www.iinpublic.com', '')).toBe('https://www.iinpublic.com');
    expect(deriveGunHubUrlFromLocation('https:', 'www.iinpublic.com', '')).toBe('https://www.iinpublic.com/gun');

    expect(deriveBackendApiBaseFromLocation('http:', '192.168.10.48', '3001')).toBe('http://192.168.10.48:8080');
    expect(deriveGunHubUrlFromLocation('http:', 'devbox.local', '3003')).toBe('http://devbox.local:8082/gun');

    expect(deriveBackendApiBaseFromLocation('http:', '127.0.0.1', '8088')).toBe('http://127.0.0.1:8088');
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '8088')).toBe('http://127.0.0.1:8088/gun');
  });

  it('keeps native embedded nodes configured for the production hub without generic Gun peering', () => {
    const embedded = resolveEmbeddedNodeConfig({ IINPUBLIC_EMBEDDED_NODE: '1' });

    expect(embedded.hubGunPeers).toEqual([EMBEDDED_NODE_DEFAULT_HUB]);
    expect(embedded.upstreamHubBaseUrl).toBe('https://www.iinpublic.com');
    expect(embedded.hubRelayMode).toBe('explicit-http');
    expect(embedded.loopbackOnly).toBe(true);
    expect(resolveUpstreamHubPeers(embedded, { e2eMemoryOnly: false, devGunFresh: false })).toEqual([]);
  });

  it('restricts production CORS while allowing non-production LAN development origins', () => {
    process.env.NODE_ENV = 'production';
    expect(buildAllowedOrigin()).toEqual([
      /^https:\/\/(?:www\.)?iinpublic\.com$/,
      'https://iinpublic-network.onrender.com',
    ]);

    // This assertion is specifically about the HTTPS-required (non-plaintext-test) branch of
    // `buildAllowedOrigin()`, so it must control both env vars that select the plaintext branch
    // itself rather than assume they're unset ambiently — `npm run test:all` runs this suite
    // with `E2E_GUN_MEMORY_ONLY=1` already exported for the E2E phases, which otherwise flips
    // this to the http:// regex and fails the https:// assertions below.
    delete process.env.E2E_GUN_MEMORY_ONLY;
    delete process.env.TLS_DISABLE;
    process.env.NODE_ENV = 'test';
    const devOrigin = buildAllowedOrigin();
    expect(devOrigin).toBeInstanceOf(RegExp);
    expect((devOrigin as RegExp).test('https://localhost:3001')).toBe(true);
    expect((devOrigin as RegExp).test('https://192.168.10.48:3001')).toBe(true);
    expect((devOrigin as RegExp).test('https://iinpublic-lan.localhost:3001')).toBe(true);
    expect((devOrigin as RegExp).test('http://localhost:3001')).toBe(false);
  });

  it('allows HTTP origins only in explicitly isolated test mode', () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_GUN_MEMORY_ONLY = '1';
    const testOrigin = buildAllowedOrigin();

    expect((testOrigin as RegExp).test('http://localhost:3001')).toBe(true);
    expect((testOrigin as RegExp).test('https://localhost:3001')).toBe(false);
  });

  it('allows an operator to replace the production origin allowlist', () => {
    process.env.NODE_ENV = 'production';
    process.env.IINPUBLIC_ALLOWED_ORIGINS =
      'https://preview.example, https://another.example';

    expect(buildAllowedOrigin()).toEqual([
      'https://preview.example',
      'https://another.example',
    ]);
  });

  it('keeps hard-coded loopback URLs limited to explicit native/dev-local paths', () => {
    const allowedFiles = new Set([
      'android/app/src/main/java/com/iinpublic/app/MainActivity.kt',
      'android/app/src/main/java/com/iinpublic/app/NearbyConnectivityManager.kt',
      'android/app/src/main/java/com/iinpublic/app/NodeBridge.kt',
      'android/app/src/main/java/com/iinpublic/app/NodeForegroundService.kt',
      'platforms/desktop/main.js',
      'platforms/ios/IinPublic/ViewController.swift',
      'src/node-app/embedded-node.ts',
      'src/shared/config.ts',
      'src/shared/embedded-node-config.ts',
      'src/shared/p2p-runtime.ts',
      'src/web/app/app.ts',
      'src/web/index.ts',
      'src/web/services/direct-p2p-conversation-transport.ts',
      'src/web/services/gun-bridge.ts',
      'src/web/services/loopback-probe.ts',
      'src/web/services/p2p-local-node-bridge-client.ts',
      'src/web/services/web-chatroom-service.ts',
      'src/web/services/web-gun-service.ts',
    ]);
    const roots = ['android', 'platforms/desktop', 'platforms/ios', 'src/node-app', 'src/shared', 'src/web'];
    const extensions = new Set(['.ts', '.js', '.kt', '.swift']);
    const loopbackPattern = /(https?:\/\/(?:localhost|127\.0\.0\.1)|ws:\/\/127\.0\.0\.1|localhost:\d+)/;
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walkFiles(path.join(repoRoot, root), extensions)) {
        const rel = path.relative(repoRoot, file);
        if (!loopbackPattern.test(fs.readFileSync(file, 'utf8'))) continue;
        if (!allowedFiles.has(rel)) offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
