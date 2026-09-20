/**
 * Real Firefox on `ubuntu-test`, driven through a Playwright server running on that host
 * (`playwright run-server`) and tunnelled back to this Mac — Firefox has no CDP, so this is the
 * Firefox counterpart to `ubuntu-live-peer.ts`. Same reverse-tunnel contract: callers navigate to
 * `http://127.0.0.1:<webPort>/...` on the REMOTE loopback (secure context), never a LAN IP.
 * Requires a deployed workspace for the current revision (any `launchUbuntuDesktopPeer` /
 * `test:e2e:ubuntu:*` run creates it) whose Playwright version matches this checkout.
 */
import { firefox, type Browser, type Page } from '@playwright/test';
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hosts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8')) as {
  ubuntu: { sshHost: string; workspaceRoot: string; nodeVersion: string };
};
const SSH_HOST = process.env.UBUNTU_E2E_SSH_HOST || hosts.ubuntu.sshHost;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

export type UbuntuFirefoxPeer = { browser: Browser; page: Page; close: () => Promise<void> };

export async function launchUbuntuFirefoxPeer(options: { port?: number; reverseForwardPorts?: number[] } = {}): Promise<UbuntuFirefoxPeer> {
  const port = options.port ?? 19_888;
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const home = (await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'echo $HOME'], { timeout: 15_000 })).stdout.trim();
  const workspace = `${home}/${hosts.ubuntu.workspaceRoot}/${revision}`;
  const node = `${home}/iinpublic-tools/node-v${hosts.ubuntu.nodeVersion}-linux-x64/bin/node`;
  const uid = (await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'id -u'], { timeout: 10_000 })).stdout.trim();

  const kill = () => execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pkill -f 'run-server --port ${port}' || true`], { timeout: 15_000 }).catch(() => {});
  await kill();
  const launch = await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST,
    `cd ${workspace} && test -x node_modules/.bin/playwright || exit 1; DISPLAY=${process.env.UBUNTU_E2E_DISPLAY || ':1'} XAUTHORITY=/run/user/${uid}/gdm/Xauthority ` +
    `nohup ${node} node_modules/playwright/cli.js run-server --port ${port} --host 127.0.0.1 < /dev/null > /tmp/iinpublic-ubuntu-pw-server-${port}.log 2>&1 & disown; echo launched`,
  ], { timeout: 20_000 });
  if (!launch.stdout.includes('launched')) throw new Error(`Failed to start the Ubuntu Playwright server (is the ${revision.slice(0, 12)} workspace deployed?): ${launch.stdout}${launch.stderr}`);

  let tunnel: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    tunnel = spawn('ssh', ['-N', '-L', `${port}:127.0.0.1:${port}`,
      ...(options.reverseForwardPorts ?? []).flatMap((p) => ['-R', `${p}:127.0.0.1:${p}`]), ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
    let lastError: unknown;
    for (let attempt = 0; attempt < 30 && !browser; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      try { browser = await firefox.connect(`ws://127.0.0.1:${port}/`, { timeout: 15_000 }); } catch (error) { lastError = error; }
    }
    if (!browser) throw new Error(`Could not connect to the Ubuntu Firefox server: ${String(lastError)}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    return {
      browser,
      page,
      close: async () => {
        await browser?.close().catch(() => {});
        tunnel?.kill();
        await kill();
      },
    };
  } catch (error) {
    await browser?.close().catch(() => {});
    tunnel?.kill();
    await kill();
    throw error;
  }
}
