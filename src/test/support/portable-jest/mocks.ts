/**
 * jest.fn / jest.spyOn and Jest's modern fake timers for the portable runtime, so unit files that
 * spy or fake time run unchanged on a phone. Module mocking (jest.mock, requireActual,
 * isolateModules) is not here: it needs a module registry, and files that use it stay host-only.
 *
 * Every file shares one realm on a phone, where Jest gives each file its own. The runtime calls
 * endFileIsolation() after each file: spies are restored and real timers come back, so nothing a
 * file forgot to undo leaks into the next one.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyFn = (...args: any[]) => any;
type MockResult = { type: 'return' | 'throw' | 'incomplete'; value: unknown };

export type PortableMock = AnyFn & {
  _isMockFunction: true;
  mock: { calls: unknown[][]; results: MockResult[]; instances: unknown[]; contexts: unknown[]; lastCall: unknown[] | undefined };
  getMockName(): string;
  mockName(name: string): PortableMock;
  getMockImplementation(): AnyFn | undefined;
  mockImplementation(fn: AnyFn): PortableMock;
  mockImplementationOnce(fn: AnyFn): PortableMock;
  mockReturnValue(value: unknown): PortableMock;
  mockReturnValueOnce(value: unknown): PortableMock;
  mockResolvedValue(value: unknown): PortableMock;
  mockResolvedValueOnce(value: unknown): PortableMock;
  mockRejectedValue(value: unknown): PortableMock;
  mockRejectedValueOnce(value: unknown): PortableMock;
  mockReturnThis(): PortableMock;
  mockClear(): PortableMock;
  mockReset(): PortableMock;
  mockRestore(): void;
};

// Captured before any file can fake them: the runtime's own timeouts and durations use these.
export const realTimers = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  Date: globalThis.Date,
  now: () => realTimers.Date.now(),
};

const allMocks = new Set<PortableMock>();
const restorers = new Map<PortableMock, () => void>();
// The file a mock belongs to: the one loading (registration) or running when it was made.
const ownerOf = new Map<PortableMock, string>();
let currentOwner = '';

export function setMockOwner(file: string): void {
  currentOwner = file;
}

export function isMockFunction(value: unknown): value is PortableMock {
  return typeof value === 'function' && (value as any)._isMockFunction === true;
}

export function fn(implementation?: AnyFn): PortableMock {
  let impl: AnyFn | undefined = implementation;
  let onceQueue: AnyFn[] = [];
  let name = 'jest.fn()';
  const state: PortableMock['mock'] = { calls: [], results: [], instances: [], contexts: [], lastCall: undefined };

  const mock = function (this: unknown, ...args: unknown[]) {
    state.calls.push(args);
    state.lastCall = args;
    state.instances.push(this);
    state.contexts.push(this);
    const result: MockResult = { type: 'incomplete', value: undefined };
    state.results.push(result);
    const next = onceQueue.length ? onceQueue.shift() : impl;
    try {
      const value = next ? (new.target ? Reflect.construct(next, args, new.target) : next.apply(this, args)) : undefined;
      result.type = 'return';
      result.value = value;
      return value;
    } catch (error) {
      result.type = 'throw';
      result.value = error;
      throw error;
    }
  } as unknown as PortableMock;

  const chain = (update: () => void): PortableMock => { update(); return mock; };
  Object.assign(mock, {
    _isMockFunction: true,
    mock: state,
    getMockName: () => name,
    mockName: (value: string) => chain(() => { name = value; }),
    getMockImplementation: () => impl,
    mockImplementation: (value: AnyFn) => chain(() => { impl = value; }),
    mockImplementationOnce: (value: AnyFn) => chain(() => { onceQueue.push(value); }),
    mockReturnValue: (value: unknown) => chain(() => { impl = () => value; }),
    mockReturnValueOnce: (value: unknown) => chain(() => { onceQueue.push(() => value); }),
    mockResolvedValue: (value: unknown) => chain(() => { impl = () => Promise.resolve(value); }),
    mockResolvedValueOnce: (value: unknown) => chain(() => { onceQueue.push(() => Promise.resolve(value)); }),
    mockRejectedValue: (value: unknown) => chain(() => { impl = () => Promise.reject(value); }),
    mockRejectedValueOnce: (value: unknown) => chain(() => { onceQueue.push(() => Promise.reject(value)); }),
    mockReturnThis: () => chain(() => { impl = function (this: unknown) { return this; }; }),
    mockClear: () => chain(() => {
      state.calls = []; state.results = []; state.instances = []; state.contexts = []; state.lastCall = undefined;
    }),
    mockReset: () => chain(() => {
      mock.mockClear();
      impl = undefined;
      onceQueue = [];
    }),
    mockRestore: () => {
      mock.mockReset();
      restorers.get(mock)?.();
      restorers.delete(mock);
    },
  });
  // mockClear replaces the arrays; keep `mock.mock` pointing at the live ones.
  Object.defineProperty(mock, 'mock', { get: () => state, configurable: true });
  allMocks.add(mock);
  ownerOf.set(mock, currentOwner);
  return mock;
}

export function spyOn(object: any, method: string, accessType?: 'get' | 'set'): PortableMock {
  if (object === null || object === undefined) throw new Error(`Cannot spyOn on ${String(object)}`);
  if (accessType) {
    let owner = object;
    while (owner && !Object.getOwnPropertyDescriptor(owner, method)) owner = Object.getPrototypeOf(owner);
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, method);
    const original = descriptor?.[accessType];
    if (typeof original !== 'function') throw new Error(`${method} has no ${accessType}ter to spy on`);
    const mock = fn(function (this: unknown, ...args: unknown[]) { return original.apply(this, args); });
    const own = Object.getOwnPropertyDescriptor(object, method);
    Object.defineProperty(object, method, { ...descriptor, [accessType]: mock, configurable: true });
    restorers.set(mock, () => {
      if (own) Object.defineProperty(object, method, own);
      else delete object[method];
    });
    return mock;
  }
  const original = object[method];
  if (isMockFunction(original)) return original;
  if (typeof original !== 'function') throw new Error(`Cannot spy on ${method}: it is ${typeof original}, not a function`);
  const own = Object.getOwnPropertyDescriptor(object, method);
  const mock = fn(function (this: unknown, ...args: unknown[]) {
    return new.target ? Reflect.construct(original, args, new.target) : original.apply(this, args);
  });
  object[method] = mock;
  restorers.set(mock, () => {
    if (own) Object.defineProperty(object, method, own);
    else delete object[method];
  });
  return mock;
}

export function clearAllMocks(): void {
  for (const mock of allMocks) mock.mockClear();
}

export function resetAllMocks(): void {
  for (const mock of allMocks) mock.mockReset();
}

export function restoreAllMocks(): void {
  for (const mock of [...restorers.keys()]) mock.mockRestore();
}

// ------------------------------------------------------------------------------ fake timers

type FakeTimer = { id: number; at: number; callback: AnyFn; args: unknown[]; interval: number | undefined; order: number };

let clock: { now: number; timers: Map<number, FakeTimer>; nextId: number; nextOrder: number } | null = null;
let performanceNowDescriptor: PropertyDescriptor | undefined;
let fakedPerformance = false;

function schedule(callback: AnyFn, delay: unknown, args: unknown[], interval: boolean): number {
  if (!clock) throw new Error('fake timers are not installed');
  const ms = Math.max(0, Number(delay) || 0);
  const id = clock.nextId++;
  clock.timers.set(id, { id, at: clock.now + ms, callback, args, interval: interval ? Math.max(1, ms) : undefined, order: clock.nextOrder++ });
  return id;
}

function cancel(id: unknown): void {
  clock?.timers.delete(Number(id));
}

function nextTimer(limit: number): FakeTimer | undefined {
  let best: FakeTimer | undefined;
  for (const timer of clock?.timers.values() ?? []) {
    if (timer.at > limit) continue;
    if (!best || timer.at < best.at || (timer.at === best.at && timer.order < best.order)) best = timer;
  }
  return best;
}

function fire(timer: FakeTimer): void {
  if (!clock) return;
  clock.now = Math.max(clock.now, timer.at);
  if (timer.interval) {
    timer.at += timer.interval;
    timer.order = clock.nextOrder++;
  } else {
    clock.timers.delete(timer.id);
  }
  timer.callback(...timer.args);
}

const MAX_TIMER_RUNS = 100_000;

/** One real macrotask: lets promise chains started by a fired timer settle, like sinon's tickAsync. */
function yieldToRealLoop(): Promise<void> {
  return new Promise((resolve) => realTimers.setTimeout(resolve, 0));
}

function makeFakeDate(): DateConstructor {
  const RealDate = realTimers.Date;
  function FakeDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(clock ? clock.now : RealDate.now()).toString();
    return args.length ? new (RealDate as any)(...args) : new RealDate(clock ? clock.now : RealDate.now());
  }
  FakeDate.prototype = RealDate.prototype;
  Object.assign(FakeDate, {
    now: () => (clock ? clock.now : RealDate.now()),
    parse: RealDate.parse,
    UTC: RealDate.UTC,
  });
  return FakeDate as unknown as DateConstructor;
}

export const timers = {
  useFakeTimers(config?: { now?: number | Date }): void {
    const start = config?.now instanceof realTimers.Date ? config.now.getTime() : Number(config?.now ?? realTimers.now());
    if (clock) { clock.now = start; clock.timers.clear(); return; }
    clock = { now: start, timers: new Map(), nextId: 1, nextOrder: 0 };
    const g = globalThis as any;
    g.setTimeout = (callback: AnyFn, delay?: unknown, ...args: unknown[]) => schedule(callback, delay, args, false);
    g.setInterval = (callback: AnyFn, delay?: unknown, ...args: unknown[]) => schedule(callback, delay, args, true);
    g.clearTimeout = cancel;
    g.clearInterval = cancel;
    g.Date = makeFakeDate();
    const perf = g.performance;
    if (perf && typeof perf.now === 'function') {
      performanceNowDescriptor = Object.getOwnPropertyDescriptor(perf, 'now');
      try {
        Object.defineProperty(perf, 'now', { value: () => (clock ? clock.now : realTimers.now()), configurable: true, writable: true });
        fakedPerformance = true;
      } catch {
        fakedPerformance = false;
      }
    }
  },
  useRealTimers(): void {
    if (!clock) return;
    clock = null;
    const g = globalThis as any;
    g.setTimeout = realTimers.setTimeout;
    g.setInterval = realTimers.setInterval;
    g.clearTimeout = realTimers.clearTimeout;
    g.clearInterval = realTimers.clearInterval;
    g.Date = realTimers.Date;
    if (fakedPerformance) {
      if (performanceNowDescriptor) Object.defineProperty(g.performance, 'now', performanceNowDescriptor);
      else delete g.performance.now;
      fakedPerformance = false;
    }
  },
  advanceTimersByTime(ms: number): void {
    if (!clock) return;
    const target = clock.now + Math.max(0, ms);
    for (let runs = 0; runs < MAX_TIMER_RUNS; runs++) {
      const timer = nextTimer(target);
      if (!timer) break;
      fire(timer);
    }
    if (clock) clock.now = target;
  },
  async advanceTimersByTimeAsync(ms: number): Promise<void> {
    if (!clock) return;
    const target = clock.now + Math.max(0, ms);
    for (let runs = 0; runs < MAX_TIMER_RUNS; runs++) {
      await yieldToRealLoop();
      const timer = clock ? nextTimer(target) : undefined;
      if (!timer) break;
      fire(timer);
    }
    if (clock) clock.now = target;
    await yieldToRealLoop();
  },
  runAllTimers(): void {
    for (let runs = 0; clock && runs < MAX_TIMER_RUNS; runs++) {
      const timer = nextTimer(Infinity);
      if (!timer) return;
      fire(timer);
    }
    if (clock?.timers.size) throw new Error(`Aborting after running ${MAX_TIMER_RUNS} timers, assuming an infinite loop!`);
  },
  async runAllTimersAsync(): Promise<void> {
    for (let runs = 0; clock && runs < MAX_TIMER_RUNS; runs++) {
      await yieldToRealLoop();
      const timer = clock ? nextTimer(Infinity) : undefined;
      if (!timer) return;
      fire(timer);
    }
  },
  runOnlyPendingTimers(): void {
    if (!clock) return;
    const pending = [...clock.timers.values()].sort((a, b) => a.at - b.at || a.order - b.order);
    for (const timer of pending) if (clock?.timers.has(timer.id)) fire(timer);
  },
  async runOnlyPendingTimersAsync(): Promise<void> {
    if (!clock) return;
    const pending = [...clock.timers.values()].sort((a, b) => a.at - b.at || a.order - b.order);
    for (const timer of pending) {
      await yieldToRealLoop();
      if (clock?.timers.has(timer.id)) fire(timer);
    }
    await yieldToRealLoop();
  },
  clearAllTimers(): void { clock?.timers.clear(); },
  getTimerCount(): number { return clock?.timers.size ?? 0; },
  setSystemTime(now?: number | Date): void {
    if (!clock) return;
    clock.now = now instanceof realTimers.Date ? now.getTime() : Number(now ?? realTimers.now());
  },
  getRealSystemTime(): number { return realTimers.now(); },
  now(): number { return clock ? clock.now : realTimers.now(); },
};

/** Called by the runtime after each file: what Jest's per-file sandbox would have discarded. */
export function endFileIsolation(file: string): void {
  for (const mock of [...restorers.keys()]) if (ownerOf.get(mock) === file) mock.mockRestore();
  for (const mock of [...allMocks]) {
    if (ownerOf.get(mock) !== file) continue;
    allMocks.delete(mock);
    ownerOf.delete(mock);
  }
  timers.useRealTimers();
}
