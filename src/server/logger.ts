/**
 * Structured JSON logger (INF-05)
 *
 * Writes newline-delimited JSON to stdout, compatible with pino's output format.
 * Replace `import pino from 'pino'` with this module if pino is later added as a
 * dependency — the public API surface is intentionally identical.
 *
 * Log levels (numeric, matches pino):
 *   10 trace | 20 debug | 30 info | 40 warn | 50 error | 60 fatal
 *
 * Set LOG_LEVEL env var to control minimum output level (default: 'info').
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function resolveLevel(name: string | undefined): number {
  const lower = (name ?? 'info').toLowerCase() as LogLevel;
  return LEVEL_VALUES[lower] ?? LEVEL_VALUES.info;
}

const minLevel = resolveLevel(process.env.LOG_LEVEL);

export interface LogEntry {
  level: number;
  time: number;
  pid: number;
  hostname?: string;
  msg: string;
  [key: string]: unknown;
}

function write(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n');
}

function buildEntry(
  level: LogLevel,
  bindings: Record<string, unknown>,
  msgOrObj: string | Record<string, unknown>,
  msg?: string,
): LogEntry {
  const levelValue = LEVEL_VALUES[level];
  const time = Date.now();
  const pid = process.pid;

  let message: string;
  let extra: Record<string, unknown> = {};

  if (typeof msgOrObj === 'string') {
    message = msgOrObj;
  } else {
    extra = msgOrObj;
    message = msg ?? '';
  }

  // Flatten error objects for readability
  const flatExtra: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(extra)) {
    if (val instanceof Error) {
      flatExtra[key] = { message: val.message, stack: val.stack, name: val.name };
    } else {
      flatExtra[key] = val;
    }
  }

  return {
    level: levelValue,
    time,
    pid,
    ...bindings,
    ...flatExtra,
    msg: message,
  };
}

export class Logger {
  private bindings: Record<string, unknown>;

  constructor(bindings: Record<string, unknown> = {}) {
    this.bindings = bindings;
  }

  /** Create a child logger with additional bound fields (e.g. requestId). */
  child(additionalBindings: Record<string, unknown>): Logger {
    return new Logger({ ...this.bindings, ...additionalBindings });
  }

  trace(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    if (minLevel > LEVEL_VALUES.trace) return;
    write(buildEntry('trace', this.bindings, msgOrObj, msg));
  }

  debug(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    if (minLevel > LEVEL_VALUES.debug) return;
    write(buildEntry('debug', this.bindings, msgOrObj, msg));
  }

  info(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    if (minLevel > LEVEL_VALUES.info) return;
    write(buildEntry('info', this.bindings, msgOrObj, msg));
  }

  warn(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    if (minLevel > LEVEL_VALUES.warn) return;
    write(buildEntry('warn', this.bindings, msgOrObj, msg));
  }

  error(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    if (minLevel > LEVEL_VALUES.error) return;
    write(buildEntry('error', this.bindings, msgOrObj, msg));
  }

  fatal(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    // fatal always emits regardless of minLevel
    write(buildEntry('fatal', this.bindings, msgOrObj, msg));
  }
}

/** Root application logger — import this everywhere in server code. */
export const logger = new Logger({
  name: 'iinpublic',
  env: process.env.NODE_ENV ?? 'development',
});
