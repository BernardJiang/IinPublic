/**
 * The generated entry imports this first so the Jest globals exist before any test file's module
 * body runs (esbuild evaluates each require()d file lazily, in order).
 */
import { installJestGlobals } from './runtime';

installJestGlobals(globalThis as unknown as Record<string, unknown>);

// The same test-only knobs src/test/setup.ts sets for host Jest (small retention windows), so
// web-service tests see the same configuration on a phone.
Object.assign(process.env, {
  NODE_ENV: 'test',
  IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW: '500',
  IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW: '200',
});
