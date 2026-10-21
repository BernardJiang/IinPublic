/**
 * Test-only API latency (docs/testing/journey-coverage.md, "Realistic timing").
 *
 * E2E servers keep Gun in memory and answer at once; the production hub reads from disk and,
 * for an empty room, takes ~2.6 s. Client timeouts tuned against the fast path (the 2.5 s relay
 * membership timeout, 2026-10-13) then fail only in production. Setting
 * `E2E_HUB_API_DELAY_MS=<ms>` delays every matching `/api/` response by that much so journeys
 * run against production-like timing. `E2E_HUB_API_DELAY_PATHS` (a regular expression, default
 * every `/api/` path) narrows it. Never set in production; inert unless the variable is set.
 */
import type { NextFunction, Request, Response } from 'express';

export type E2eLatencyConfig = { delayMs: number; pathPattern: RegExp };

export function resolveE2eLatencyConfig(env: NodeJS.ProcessEnv = process.env): E2eLatencyConfig | null {
  const delayMs = parseInt(env.E2E_HUB_API_DELAY_MS || '', 10);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return null;
  let pathPattern = /^\/api\//;
  if (env.E2E_HUB_API_DELAY_PATHS) {
    try {
      pathPattern = new RegExp(env.E2E_HUB_API_DELAY_PATHS);
    } catch {
      // keep the default on an invalid pattern
    }
  }
  return { delayMs, pathPattern };
}

export function createE2eLatencyMiddleware(config: E2eLatencyConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!config.pathPattern.test(req.path) || req.path.startsWith('/api/test/')) {
      next();
      return;
    }
    setTimeout(next, config.delayMs);
  };
}
