/**
 * A small Jest-compatible runtime so that pure unit files (src/test/unit, no jest.* mocks, no
 * Node built-ins, no DOM) run UNCHANGED on a phone: in the app WebView and in embedded Node.
 * It covers describe/it/test (.each/.skip/.only/.todo), the four hooks, and the matchers those
 * files use. A file that needs anything else is left out by scripts/build-portable-core-test-bundle.mjs
 * and stays host-only; it is never half-run.
 */

type Fn = () => unknown | Promise<unknown>;

type TestCase = { name: string; fn: Fn | undefined; skip: boolean };
type Suite = {
  name: string;
  skip: boolean;
  children: Array<{ kind: 'suite'; suite: Suite } | { kind: 'test'; test: TestCase }>;
  beforeAll: Fn[];
  afterAll: Fn[];
  beforeEach: Fn[];
  afterEach: Fn[];
};

export type PortableJestResult = { id: string; passed: boolean; skipped?: boolean; durationMs: number; error?: string };
export type PortableJestFileReport = { file: string; passed: number; failed: number; skipped: number; results: PortableJestResult[] };
export type PortableJestReport = {
  schemaVersion: 1;
  files: number;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  reports: PortableJestFileReport[];
};

function newSuite(name: string, skip = false): Suite {
  return { name, skip, children: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
}

const files: Array<{ file: string; root: Suite }> = [];
let current: Suite = newSuite('');
let hostOnlyTests = new Set<string>();

/** "<file> › <test id>" of tests reported as skipped on a phone (host-calibrated benchmarks). */
export function setHostOnlyTests(ids: readonly string[]): void {
  hostOnlyTests = new Set(ids);
}

/** Called by the generated entry before each test file's module body runs. */
export function beginFile(file: string): void {
  current = newSuite('');
  files.push({ file, root: current });
}

/** The file's module body threw while loading (an import this runtime lacks): one failed test. */
export function fileLoadFailed(error: unknown): void {
  current.children.push({ kind: 'test', test: { name: '(file failed to load)', fn: () => { throw error; }, skip: false } });
}

// ---------------------------------------------------------------------------------- formatting

function show(value: unknown): string {
  try {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'bigint') return `${value}n`;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (value instanceof Map) return `Map(${show([...value.entries()])})`;
    if (value instanceof Set) return `Set(${show([...value.values()])})`;
    if (value instanceof AsymmetricMatcher) return value.toString();
    const text = JSON.stringify(value, (_key, v) => (v === undefined ? '__undefined__' : typeof v === 'bigint' ? `${v}n` : v));
    return text === undefined ? String(value) : text.replace(/"__undefined__"/g, 'undefined');
  } catch {
    return String(value);
  }
}

function clip(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function formatEachName(template: string, args: unknown[], index: number): string {
  let next = 0;
  let name = template.replace(/%([sdifjopP#%])/g, (_match, flag: string) => {
    if (flag === '%') return '%';
    if (flag === '#') return String(index);
    const value = args[next++];
    if (flag === 'd' || flag === 'i') return String(flag === 'i' ? Math.trunc(Number(value)) : Number(value));
    if (flag === 'f') return String(Number(value));
    if (flag === 's') return typeof value === 'string' ? value : show(value);
    return show(value);
  });
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const row = args[0] as Record<string, unknown>;
    name = name.replace(/\$([A-Za-z_][\w.]*)/g, (match, key: string) => {
      let value: unknown = row;
      for (const part of key.split('.')) value = (value as Record<string, unknown> | undefined)?.[part];
      return value === undefined && !(key in row) ? match : (typeof value === 'string' ? value : show(value));
    });
  }
  return name;
}

// ----------------------------------------------------------------------------- registration

function addTest(name: string, fn: Fn | undefined, skip: boolean): void {
  current.children.push({ kind: 'test', test: { name, fn, skip } });
}

function addSuite(name: string, body: () => void, skip: boolean): void {
  const suite = newSuite(name, skip || current.skip);
  current.children.push({ kind: 'suite', suite });
  const parent = current;
  current = suite;
  try {
    const returned = body() as unknown;
    if (returned && typeof (returned as Promise<unknown>).then === 'function') {
      throw new Error('describe() bodies must be synchronous');
    }
  } finally {
    current = parent;
  }
}

type EachRow = unknown[] | Record<string, unknown> | unknown;

function eachRows(table: readonly EachRow[]): unknown[][] {
  return table.map((row) => (Array.isArray(row) ? row : [row]));
}

function makeTestApi(skipAll: boolean) {
  const api = (name: string, fn?: Fn) => addTest(name, fn, skipAll);
  return api;
}

const testApi = Object.assign(makeTestApi(false), {
  skip: makeTestApi(true),
  only: makeTestApi(false),
  todo: (name: string) => addTest(name, undefined, true),
  each: (table: readonly EachRow[]) => (name: string, fn: (...args: any[]) => unknown) => {
    eachRows(table).forEach((args, index) => addTest(formatEachName(name, args, index), () => fn(...args), false));
  },
});

const describeApi = Object.assign((name: string, body: () => void) => addSuite(name, body, false), {
  skip: (name: string, body: () => void) => addSuite(name, body, true),
  only: (name: string, body: () => void) => addSuite(name, body, false),
  each: (table: readonly EachRow[]) => (name: string, body: (...args: any[]) => void) => {
    eachRows(table).forEach((args, index) => addSuite(formatEachName(name, args, index), () => body(...args), false));
  },
});

// ------------------------------------------------------------------------------- equality

abstract class AsymmetricMatcher {
  abstract matches(actual: unknown): boolean;
  abstract toString(): string;
}

class AnyMatcher extends AsymmetricMatcher {
  constructor(private readonly ctor: any) { super(); }
  matches(actual: unknown): boolean {
    const ctor = this.ctor;
    if (ctor === String) return typeof actual === 'string' || actual instanceof String;
    if (ctor === Number) return typeof actual === 'number' || actual instanceof Number;
    if (ctor === Boolean) return typeof actual === 'boolean' || actual instanceof Boolean;
    if (ctor === Function) return typeof actual === 'function';
    if (ctor === Object) return actual !== null && typeof actual === 'object';
    if (ctor === BigInt) return typeof actual === 'bigint';
    if (ctor === Symbol) return typeof actual === 'symbol';
    return actual instanceof ctor;
  }
  toString(): string { return `Any<${this.ctor?.name || 'unknown'}>`; }
}

class AnythingMatcher extends AsymmetricMatcher {
  matches(actual: unknown): boolean { return actual !== null && actual !== undefined; }
  toString(): string { return 'Anything'; }
}

class ObjectContaining extends AsymmetricMatcher {
  constructor(private readonly sample: Record<string, unknown>, private readonly inverse = false) { super(); }
  matches(actual: unknown): boolean {
    const result = actual !== null && typeof actual === 'object'
      && Object.keys(this.sample).every((key) => hasOwnOrInherited(actual, key) && equals((actual as any)[key], this.sample[key]));
    return this.inverse ? !result : result;
  }
  toString(): string { return `${this.inverse ? 'Not' : ''}ObjectContaining ${show(this.sample)}`; }
}

class ArrayContaining extends AsymmetricMatcher {
  constructor(private readonly sample: unknown[], private readonly inverse = false) { super(); }
  matches(actual: unknown): boolean {
    const result = Array.isArray(actual) && this.sample.every((item) => actual.some((value) => equals(value, item)));
    return this.inverse ? !result : result;
  }
  toString(): string { return `${this.inverse ? 'Not' : ''}ArrayContaining ${show(this.sample)}`; }
}

class StringContaining extends AsymmetricMatcher {
  constructor(private readonly sample: string, private readonly inverse = false) { super(); }
  matches(actual: unknown): boolean {
    const result = typeof actual === 'string' && actual.includes(this.sample);
    return this.inverse ? !result : result;
  }
  toString(): string { return `StringContaining ${show(this.sample)}`; }
}

class StringMatching extends AsymmetricMatcher {
  constructor(private readonly sample: string | RegExp, private readonly inverse = false) { super(); }
  matches(actual: unknown): boolean {
    const result = typeof actual === 'string' && (typeof this.sample === 'string' ? actual.includes(this.sample) : this.sample.test(actual));
    return this.inverse ? !result : result;
  }
  toString(): string { return `StringMatching ${String(this.sample)}`; }
}

class CloseTo extends AsymmetricMatcher {
  constructor(private readonly sample: number, private readonly digits = 2) { super(); }
  matches(actual: unknown): boolean {
    return typeof actual === 'number' && Math.abs(actual - this.sample) < Math.pow(10, -this.digits) / 2;
  }
  toString(): string { return `CloseTo ${this.sample}`; }
}

function hasOwnOrInherited(object: unknown, key: string): boolean {
  return object !== null && object !== undefined && key in Object(object);
}

/** Jest's recursive equality. `strict` is toStrictEqual: undefined properties and types count. */
function equals(a: unknown, b: unknown, strict = false, seen: Array<[unknown, unknown]> = []): boolean {
  if (b instanceof AsymmetricMatcher) return b.matches(a);
  if (a instanceof AsymmetricMatcher) return a.matches(b);
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen = [...seen, [a, b]];
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && String(a) === String(b);
  }
  if (a instanceof Error && b instanceof Error) return a.message === b.message;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((value, index) => value === y[index]);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !equals(value, b.get(key), strict, seen)) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value) && ![...b].some((other) => equals(value, other, strict, seen))) return false;
    }
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
      if (strict && ((index in a) !== (index in b))) return false;
      if (!equals(a[index], b[index], strict, seen)) return false;
    }
    if (!strict) return true;
  }
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = (object: object) => Object.keys(object).filter((key) => strict || (object as any)[key] !== undefined);
  const aKeys = keys(a as object);
  const bKeys = keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((key) => Object.prototype.hasOwnProperty.call(a, key)
    && equals((a as any)[key], (b as any)[key], strict, seen));
}

/** toMatchObject: every property of `expected` matches, recursively; arrays match item by item. */
function matchesObject(actual: unknown, expected: unknown): boolean {
  if (expected instanceof AsymmetricMatcher) return expected.matches(actual);
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) {
    return equals(actual, expected);
  }
  if (expected instanceof Date || expected instanceof RegExp || expected instanceof Map || expected instanceof Set) {
    return equals(actual, expected);
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((item, index) => matchesObject(actual[index], item));
  }
  return Object.keys(expected).every((key) => hasOwnOrInherited(actual, key)
    && matchesObject((actual as any)[key], (expected as any)[key]));
}

// ------------------------------------------------------------------------------- matchers

class AssertionError extends Error {}

function propertyPath(path: string | readonly (string | number)[]): Array<string | number> {
  if (Array.isArray(path)) return [...path];
  return String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter((part) => part !== '');
}

function thrownMatches(error: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof expected === 'string') return message.includes(expected);
  if (expected instanceof RegExp) return expected.test(message);
  if (expected instanceof Error) return message === expected.message;
  if (typeof expected === 'function') return error instanceof (expected as any);
  if (expected instanceof AsymmetricMatcher) return expected.matches(error);
  if (expected && typeof expected === 'object') return matchesObject(error, expected);
  return false;
}

type MatcherResult = { pass: boolean; message: string };

function matchers(actual: unknown): Record<string, (...args: any[]) => MatcherResult> {
  const a = actual as any;
  return {
    toBe: (expected) => ({ pass: Object.is(actual, expected), message: `expected ${show(actual)} to be ${show(expected)}` }),
    toEqual: (expected) => ({ pass: equals(actual, expected), message: `expected ${clip(show(actual))} to equal ${clip(show(expected))}` }),
    toStrictEqual: (expected) => ({ pass: equals(actual, expected, true), message: `expected ${clip(show(actual))} to strictly equal ${clip(show(expected))}` }),
    toMatchObject: (expected) => ({ pass: matchesObject(actual, expected), message: `expected ${clip(show(actual))} to match object ${clip(show(expected))}` }),
    toBeNull: () => ({ pass: actual === null, message: `expected ${show(actual)} to be null` }),
    toBeUndefined: () => ({ pass: actual === undefined, message: `expected ${show(actual)} to be undefined` }),
    toBeDefined: () => ({ pass: actual !== undefined, message: `expected ${show(actual)} to be defined` }),
    toBeTruthy: () => ({ pass: !!actual, message: `expected ${show(actual)} to be truthy` }),
    toBeFalsy: () => ({ pass: !actual, message: `expected ${show(actual)} to be falsy` }),
    toBeNaN: () => ({ pass: Number.isNaN(actual), message: `expected ${show(actual)} to be NaN` }),
    toBeGreaterThan: (n) => ({ pass: a > n, message: `expected ${show(actual)} > ${show(n)}` }),
    toBeGreaterThanOrEqual: (n) => ({ pass: a >= n, message: `expected ${show(actual)} >= ${show(n)}` }),
    toBeLessThan: (n) => ({ pass: a < n, message: `expected ${show(actual)} < ${show(n)}` }),
    toBeLessThanOrEqual: (n) => ({ pass: a <= n, message: `expected ${show(actual)} <= ${show(n)}` }),
    toBeCloseTo: (n, digits = 2) => ({
      pass: (a === Infinity && n === Infinity) || (a === -Infinity && n === -Infinity) || Math.abs(a - n) < Math.pow(10, -digits) / 2,
      message: `expected ${show(actual)} to be close to ${show(n)} (${digits} digits)`,
    }),
    toBeInstanceOf: (ctor) => ({ pass: actual instanceof ctor, message: `expected ${show(actual)} to be an instance of ${ctor?.name}` }),
    toHaveLength: (n) => ({ pass: a != null && a.length === n, message: `expected length ${n}, received ${a?.length} (${clip(show(actual))})` }),
    toContain: (item) => ({
      pass: typeof actual === 'string' ? actual.includes(item) : a != null && Array.from(a as Iterable<unknown>).includes(item),
      message: `expected ${clip(show(actual))} to contain ${show(item)}`,
    }),
    toContainEqual: (item) => ({
      pass: a != null && Array.from(a as Iterable<unknown>).some((value) => equals(value, item)),
      message: `expected ${clip(show(actual))} to contain an item equal to ${show(item)}`,
    }),
    toMatch: (pattern) => ({
      pass: typeof actual === 'string' && (typeof pattern === 'string' ? actual.includes(pattern) : new RegExp(pattern).test(actual)),
      message: `expected ${show(actual)} to match ${String(pattern)}`,
    }),
    toHaveProperty: (path, ...value) => {
      let target: any = actual;
      let found = true;
      for (const part of propertyPath(path)) {
        if (target === null || target === undefined || !(part in Object(target))) { found = false; break; }
        target = target[part];
      }
      const pass = found && (value.length === 0 || equals(target, value[0]));
      return { pass, message: `expected ${clip(show(actual))} to have property ${show(path)}${value.length ? ` = ${show(value[0])}` : ''}` };
    },
    toThrow: (expected) => {
      if (typeof actual !== 'function') throw new AssertionError('toThrow needs a function');
      try {
        (actual as () => unknown)();
      } catch (error) {
        return { pass: thrownMatches(error, expected), message: `expected the thrown ${show(error)} to match ${show(expected)}` };
      }
      return { pass: false, message: `expected the function to throw${expected === undefined ? '' : ` ${show(expected)}`}` };
    },
  };
}

function thrownMatcher(error: unknown, didThrow: boolean, expected: unknown): MatcherResult {
  if (!didThrow) return { pass: false, message: 'expected the promise to reject' };
  return { pass: thrownMatches(error, expected), message: `expected the rejection ${show(error)} to match ${show(expected)}` };
}

function buildExpectation(actual: unknown) {
  const make = (negate: boolean) => {
    const out: Record<string, (...args: any[]) => void> = {};
    for (const [name, matcher] of Object.entries(matchers(actual))) {
      out[name] = (...args: any[]) => {
        const result = matcher(...args);
        if (result.pass === negate) throw new AssertionError(`${negate ? 'not ' : ''}${name}: ${result.message}`);
      };
    }
    out.toThrowError = out.toThrow;
    return out;
  };
  const promised = (negate: boolean, mode: 'resolves' | 'rejects') => {
    const out: Record<string, (...args: any[]) => Promise<void>> = {};
    for (const name of Object.keys(matchers(undefined)).concat('toThrowError')) {
      out[name] = async (...args: any[]) => {
        let value: unknown;
        let rejected = false;
        try {
          value = await (actual as Promise<unknown>);
        } catch (error) {
          value = error;
          rejected = true;
        }
        if (mode === 'resolves' && rejected) throw new AssertionError(`resolves.${name}: the promise rejected with ${show(value)}`);
        if (mode === 'rejects' && !rejected) throw new AssertionError(`rejects.${name}: the promise resolved with ${show(value)}`);
        if (mode === 'rejects' && (name === 'toThrow' || name === 'toThrowError')) {
          const result = thrownMatcher(value, true, args[0]);
          if (result.pass === negate) throw new AssertionError(`rejects.${negate ? 'not.' : ''}${name}: ${result.message}`);
          return;
        }
        const matcher = matchers(value)[name === 'toThrowError' ? 'toThrow' : name];
        const result = matcher(...args);
        if (result.pass === negate) throw new AssertionError(`${mode}.${negate ? 'not.' : ''}${name}: ${result.message}`);
      };
    }
    return out;
  };
  return Object.assign(make(false), {
    not: make(true),
    resolves: Object.assign(promised(false, 'resolves'), { not: promised(true, 'resolves') }),
    rejects: Object.assign(promised(false, 'rejects'), { not: promised(true, 'rejects') }),
  });
}

const expectApi = Object.assign((actual: unknown) => buildExpectation(actual), {
  any: (ctor: unknown) => new AnyMatcher(ctor),
  anything: () => new AnythingMatcher(),
  objectContaining: (sample: Record<string, unknown>) => new ObjectContaining(sample),
  arrayContaining: (sample: unknown[]) => new ArrayContaining(sample),
  stringContaining: (sample: string) => new StringContaining(sample),
  stringMatching: (sample: string | RegExp) => new StringMatching(sample),
  closeTo: (sample: number, digits?: number) => new CloseTo(sample, digits),
  not: {
    objectContaining: (sample: Record<string, unknown>) => new ObjectContaining(sample, true),
    arrayContaining: (sample: unknown[]) => new ArrayContaining(sample, true),
    stringContaining: (sample: string) => new StringContaining(sample, true),
    stringMatching: (sample: string | RegExp) => new StringMatching(sample, true),
  },
  assertions: () => undefined,
  hasAssertions: () => undefined,
});

/** Install the globals a Jest file expects. Called once by the generated entry. */
export function installJestGlobals(target: Record<string, unknown>): void {
  Object.assign(target, {
    describe: describeApi,
    it: testApi,
    test: testApi,
    expect: expectApi,
    beforeAll: (fn: Fn) => current.beforeAll.push(fn),
    afterAll: (fn: Fn) => current.afterAll.push(fn),
    beforeEach: (fn: Fn) => current.beforeEach.push(fn),
    afterEach: (fn: Fn) => current.afterEach.push(fn),
  });
}

// --------------------------------------------------------------------------------- running

const TEST_TIMEOUT_MS = 30_000;

async function call(fn: Fn): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${TEST_TIMEOUT_MS} ms`)), TEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error));
}

async function runSuite(
  file: string,
  suite: Suite,
  path: string[],
  inherited: { beforeEach: Fn[]; afterEach: Fn[] },
  out: PortableJestResult[],
): Promise<void> {
  const names = suite.name ? [...path, suite.name] : path;
  const hooks = {
    beforeEach: [...inherited.beforeEach, ...suite.beforeEach],
    afterEach: [...suite.afterEach, ...inherited.afterEach],
  };
  const tests = (s: Suite): TestCase[] => s.children.flatMap((child) => (child.kind === 'test' ? [child.test] : tests(child.suite)));
  const runnable = !suite.skip && tests(suite).some((test) => !test.skip && test.fn);
  let setupError = '';
  if (runnable) {
    for (const hook of suite.beforeAll) {
      try { await call(hook); } catch (error) { setupError = `beforeAll: ${errorText(error)}`; break; }
    }
  }
  for (const child of suite.children) {
    if (child.kind === 'suite') {
      if (setupError) {
        for (const test of tests(child.suite)) out.push({ id: [...names, child.suite.name, test.name].join(' › '), passed: false, durationMs: 0, error: setupError });
      } else {
        await runSuite(file, child.suite, names, hooks, out);
      }
      continue;
    }
    const { test } = child;
    const id = [...names, test.name].join(' › ');
    if (suite.skip || test.skip || !test.fn || hostOnlyTests.has(`${file} › ${id}`)) {
      out.push({ id, passed: true, skipped: true, durationMs: 0 });
      continue;
    }
    if (setupError) {
      out.push({ id, passed: false, durationMs: 0, error: setupError });
      continue;
    }
    const startedAt = Date.now();
    let error = '';
    try {
      for (const hook of hooks.beforeEach) await call(hook);
      await call(test.fn);
    } catch (caught) {
      error = errorText(caught);
    }
    for (const hook of hooks.afterEach) {
      try { await call(hook); } catch (caught) { error ||= `afterEach: ${errorText(caught)}`; }
    }
    out.push({ id, passed: !error, durationMs: Date.now() - startedAt, ...(error ? { error } : {}) });
  }
  if (runnable) {
    for (const hook of suite.afterAll) {
      try { await call(hook); } catch { /* reported by the tests' own failures */ }
    }
  }
}

/** Run every registered file, one after another, and report each test by a stable id. */
export async function runPortableJest(): Promise<PortableJestReport> {
  const startedAt = Date.now();
  const reports: PortableJestFileReport[] = [];
  for (const { file, root } of files) {
    const results: PortableJestResult[] = [];
    await runSuite(file, root, [], { beforeEach: [], afterEach: [] }, results);
    const failed = results.filter((result) => !result.passed).length;
    const skipped = results.filter((result) => result.skipped).length;
    reports.push({ file, passed: results.length - failed - skipped, failed, skipped, results });
  }
  const sum = (key: 'passed' | 'failed' | 'skipped') => reports.reduce((total, report) => total + report[key], 0);
  return {
    schemaVersion: 1,
    files: reports.length,
    passed: sum('passed'),
    failed: sum('failed'),
    skipped: sum('skipped'),
    total: sum('passed') + sum('failed') + sum('skipped'),
    durationMs: Date.now() - startedAt,
    reports,
  };
}
