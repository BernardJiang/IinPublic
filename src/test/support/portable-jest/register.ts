/**
 * The generated entry imports this first so the Jest globals exist before any test file's module
 * body runs (esbuild evaluates each require()d file lazily, in order).
 */
import { installJestGlobals } from './runtime';

installJestGlobals(globalThis as unknown as Record<string, unknown>);
