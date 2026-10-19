/**
 * OPEN-73 diagnostics: what an embedded phone node does while the app sits idle. A loopback-only,
 * non-production debug endpoint records a CPU profile with Node's inspector (when this build has
 * one), event-loop use, and HTTP requests by route over the same window.
 */
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'perf_hooks';

const requestCounts = new Map<string, number>();
/** Gun wire traffic by record-path shape: `in put`, `in get`, `out put`, `out get`. */
const gunCounts = new Map<string, number>();
let gunCounterInstalled = false;

/** A Gun soul with ids collapsed, so `users/<id>/status` counts as one shape. */
export function soulShape(soul: unknown): string {
  const text = String(soul ?? '');
  if (!text) return '(none)';
  if (text.startsWith('~')) return text.includes('/') ? `~pub/${text.split('/').slice(1, 3).join('/')}` : '~pub';
  return text
    .split('/')
    .slice(0, 4)
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || part.length > 24 || /\d{6,}/.test(part) ? ':id' : part))
    .join('/');
}

type GunHookTarget = { to: { next: (value: unknown) => void } };
type GunWithEvents = { on: (event: string, fn: (this: GunHookTarget, value: any) => void) => void };

/** Count Gun wire messages (debug builds only; call before the Gun instance is created). */
export function installGunWireCounter(Gun: GunWithEvents): void {
  if (gunCounterInstalled) return;
  gunCounterInstalled = true;
  const count = (direction: string, msg: any) => {
    const put = msg?.put;
    if (put && typeof put === 'object') {
      const souls = typeof put['#'] === 'string' ? [put['#']] : Object.keys(put);
      for (const soul of souls) {
        const key = `${direction} put ${soulShape(soul)}`;
        gunCounts.set(key, (gunCounts.get(key) ?? 0) + 1);
      }
    }
    const get = msg?.get;
    if (get && typeof get === 'object') {
      const key = `${direction} get ${soulShape(get['#'])}`;
      gunCounts.set(key, (gunCounts.get(key) ?? 0) + 1);
    }
  };
  Gun.on('create', function (this: GunHookTarget, root: any) {
    this.to.next(root);
    root.on('in', function (this: GunHookTarget, msg: unknown) { count('in', msg); this.to.next(msg); });
    root.on('out', function (this: GunHookTarget, msg: unknown) { count('out', msg); this.to.next(msg); });
  });
}
const requestBytes = new Map<string, number>();

/** Route shape without ids, so counts group by endpoint. */
export function routeKey(method: string, path: string): string {
  const shape = path
    .split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/[A-Za-z0-9_%.-]{24,}/g, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
  return `${method} ${shape}`;
}

export function requestCounter(req: Request, res: Response, next: NextFunction): void {
  const key = routeKey(req.method, req.originalUrl || req.url);
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  res.on('finish', () => {
    const length = Number(res.getHeader('content-length') ?? 0);
    if (Number.isFinite(length) && length > 0) requestBytes.set(key, (requestBytes.get(key) ?? 0) + length);
  });
  next();
}

export type RuntimeWindowReport = {
  seconds: number;
  eventLoopUtilization: number;
  requests: Array<{ route: string; count: number; bytes: number }>;
  gun: Array<{ key: string; count: number }>;
  profile: unknown | null;
  profileUnavailable?: string;
};

type InspectorSession = {
  connect(): void;
  disconnect(): void;
  post(method: string, params: unknown, callback: (error: Error | null, result?: unknown) => void): void;
  post(method: string, callback: (error: Error | null, result?: unknown) => void): void;
};

function loadInspector(): { Session: new () => InspectorSession } | null {
  try {
    // A static import would crash this module on a Node build without the inspector.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('inspector') as { Session: new () => InspectorSession };
  } catch {
    return null;
  }
}

const post = (session: InspectorSession, method: string, params?: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const done = (error: Error | null, result?: unknown) => (error ? reject(error) : resolve(result));
    if (params === undefined) session.post(method, done);
    else session.post(method, params, done);
  });

/** Record `seconds` of activity; the profile is a Chrome DevTools `.cpuprofile` object. */
export async function captureRuntimeWindow(seconds: number, withProfile: boolean): Promise<RuntimeWindowReport> {
  const countsBefore = new Map(requestCounts);
  const gunBefore = new Map(gunCounts);
  const bytesBefore = new Map(requestBytes);
  const eluBefore = performance.eventLoopUtilization();
  const inspector = withProfile ? loadInspector() : null;
  let session: InspectorSession | null = null;
  let profileUnavailable: string | undefined;
  if (withProfile && !inspector) profileUnavailable = 'this Node build has no inspector module';
  if (inspector) {
    try {
      session = new inspector.Session();
      session.connect();
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.setSamplingInterval', { interval: 1000 });
      await post(session, 'Profiler.start');
    } catch (error) {
      profileUnavailable = String((error as Error)?.message || error);
      session = null;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  let profile: unknown | null = null;
  if (session) {
    try {
      profile = ((await post(session, 'Profiler.stop')) as { profile?: unknown })?.profile ?? null;
    } finally {
      session.disconnect();
    }
  }
  const elu = performance.eventLoopUtilization(eluBefore);
  const requests = [...requestCounts.entries()]
    .map(([route, count]) => ({ route, count: count - (countsBefore.get(route) ?? 0), bytes: (requestBytes.get(route) ?? 0) - (bytesBefore.get(route) ?? 0) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  const gun = [...gunCounts.entries()]
    .map(([key, value]) => ({ key, count: value - (gunBefore.get(key) ?? 0) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  return {
    seconds,
    eventLoopUtilization: Math.round(elu.utilization * 1000) / 1000,
    requests,
    gun,
    profile,
    ...(profileUnavailable ? { profileUnavailable } : {}),
  };
}
