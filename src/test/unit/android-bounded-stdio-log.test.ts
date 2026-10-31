import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');

/** The Command Line Tools compiler works on a Mac whose Xcode license is not accepted. */
const COMMAND_LINE_TOOLS = '/Library/Developer/CommandLineTools';
const hostCompiler = (): { compiler: string; env: NodeJS.ProcessEnv } => {
  if (fs.existsSync(`${COMMAND_LINE_TOOLS}/usr/bin/c++`)) {
    return {
      compiler: `${COMMAND_LINE_TOOLS}/usr/bin/c++`,
      env: { ...process.env, SDKROOT: `${COMMAND_LINE_TOOLS}/SDKs/MacOSX.sdk` },
    };
  }
  return { compiler: process.env.CXX || 'c++', env: process.env };
};

describe('embedded node stdio log (OPEN-95)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-stdio-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('trims and rotates the native log', () => {
    const binary = path.join(dir, 'check');
    const { compiler, env } = hostCompiler();
    execFileSync(compiler, [
      '-std=c++17',
      path.join(repoRoot, 'src/test/native/bounded-stdio-log-check.cpp'),
      path.join(repoRoot, 'android/app/src/main/cpp/bounded_stdio_log.cpp'),
      '-o',
      binary,
    ], { env });
    expect(execFileSync(binary, [dir]).toString()).toBe('ok\n');
  });

  // Closing fd 1 makes a real SyncWriteStream fail the same way a full disk did on the phone.
  const runWithBrokenStdout = (protect: boolean) => {
    const script = path.join(dir, 'broken-stdout.ts');
    const logger = path.join(repoRoot, 'src/server/logger.ts');
    fs.writeFileSync(script, `
      import fs from 'fs';
      import { logger, protectStdioFromWriteFailures } from ${JSON.stringify(logger)};
      if (${protect}) protectStdioFromWriteFailures();
      process.stdout.write('');
      fs.closeSync(1);
      logger.warn('first');
      setTimeout(() => {
        logger.warn('second');
        setTimeout(() => process.exit(42), 20);
      }, 20);
    `);
    const log = fs.openSync(path.join(dir, 'stdout.log'), 'a');
    try {
      return spawnSync(path.join(repoRoot, 'node_modules/.bin/tsx'), [script], {
        cwd: repoRoot,
        stdio: ['ignore', log, 'pipe'],
        timeout: 20_000,
      });
    } finally {
      fs.closeSync(log);
    }
  };

  it('survives a failed stdout write once protected', () => {
    expect(runWithBrokenStdout(true).status).toBe(42);
  }, 25_000);

  it('would die from that failed write without the protection', () => {
    expect(runWithBrokenStdout(false).status).not.toBe(42);
  }, 25_000);
});
