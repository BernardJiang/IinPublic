import fs from 'fs';
import path from 'path';
import { durableStoreDir, E2E_DURABLE_STORE_ROOT } from '../../server/services/durable-store-dir';

describe('durableStoreDir', () => {
  const saved = { e2e: process.env.E2E_GUN_MEMORY_ONLY, port: process.env.PORT };
  afterEach(() => {
    if (saved.e2e === undefined) delete process.env.E2E_GUN_MEMORY_ONLY; else process.env.E2E_GUN_MEMORY_ONLY = saved.e2e;
    if (saved.port === undefined) delete process.env.PORT; else process.env.PORT = saved.port;
  });

  it('keeps dev and production stores in the working directory, keyed by port', () => {
    delete process.env.E2E_GUN_MEMORY_ONLY;
    process.env.PORT = '18555';
    expect(durableStoreDir('techsupport-radata')).toBe(path.join(process.cwd(), 'techsupport-radata-18555'));
  });

  it('gives a test server a temp directory outside the repo, wiped at start', () => {
    process.env.E2E_GUN_MEMORY_ONLY = '1';
    process.env.PORT = '18556';
    const stale = path.join(E2E_DURABLE_STORE_ROOT, 'presence-radata-18556');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'old'), 'x');

    const dir = durableStoreDir('presence-radata');

    expect(dir).toBe(stale);
    expect(dir.startsWith(process.cwd())).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
