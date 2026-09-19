import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type MatrixPeerKind = 'browser' | 'desktop-app' | 'android-app' | 'controller';
export type MatrixFailureCategory =
  | 'ui'
  | 'network'
  | 'discovery'
  | 'persistence'
  | 'synchronization'
  | 'infrastructure'
  | 'unknown';

export type MatrixPeerMetadata = {
  id: string;
  host: string;
  platform: string;
  kind: MatrixPeerKind;
  browser?: string;
  physicalDevice?: string;
};

export type MatrixScenarioAction = {
  kind: string;
  description: string;
  payload?: Record<string, unknown>;
};

export type MatrixCommand = {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type MatrixCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type MatrixPeerStatus = {
  peer: MatrixPeerMetadata;
  state: 'idle' | 'prepared' | 'installed' | 'running' | 'stopped' | 'failed' | 'skipped';
  currentAction?: string;
  lastError?: string;
  updatedAt: string;
};

export type MatrixArtifact = {
  kind: 'log' | 'screenshot' | 'trace' | 'report' | 'crash' | 'metadata';
  path: string;
  peerId: string;
};

export interface MatrixPeerAdapter {
  prepare(): Promise<void>;
  install(): Promise<void>;
  reset(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  executeScenarioAction(action: MatrixScenarioAction): Promise<MatrixCommandResult | void>;
  collectLogs(): Promise<MatrixArtifact[]>;
  screenshot(): Promise<MatrixArtifact[]>;
  reportStatus(): Promise<MatrixPeerStatus>;
}

export type MatrixAdapterHooks = {
  prepare?: () => Promise<void>;
  install?: () => Promise<void>;
  reset?: () => Promise<void>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  execute: (action: MatrixScenarioAction) => Promise<MatrixCommandResult | void>;
  screenshots?: () => Promise<string[]>;
};

export type MatrixEvent = {
  at: string;
  operation: string;
  detail?: string;
};

export class MatrixUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixUnavailableError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyMatrixFailure(detail: string): MatrixFailureCategory {
  const value = detail.toLowerCase();
  if (/locator|selector|click|visible|screenshot|render/.test(value)) return 'ui';
  if (/websocket|network|timeout|econn|dns|ssh|offline/.test(value)) return 'network';
  if (/discover|peer|presence|mdns|dht/.test(value)) return 'discovery';
  if (/indexeddb|storage|persist|database|radisk/.test(value)) return 'persistence';
  if (/sync|converge|stale|duplicate|replicat/.test(value)) return 'synchronization';
  if (/install|executable|dependency|preflight|unavailable|configuration/.test(value)) return 'infrastructure';
  return 'unknown';
}

export async function executeMatrixCommand(command: MatrixCommand): Promise<MatrixCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timeout = command.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), command.timeoutMs)
      : undefined;
    child.once('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: code ?? (signal ? 124 : 1),
        stdout,
        stderr: signal ? `${stderr}\nProcess terminated by ${signal}`.trim() : stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/** A single lifecycle contract shared by every platform-specific matrix adapter. */
export class StandardMatrixPeerAdapter implements MatrixPeerAdapter {
  private state: MatrixPeerStatus['state'] = 'idle';
  private currentAction: string | undefined;
  private lastError: string | undefined;
  private readonly events: MatrixEvent[] = [];
  private readonly commandResults: MatrixCommandResult[] = [];

  constructor(
    readonly peer: MatrixPeerMetadata,
    private readonly artifactDirectory: string,
    private readonly hooks: MatrixAdapterHooks,
  ) {}

  private event(operation: string, detail?: string): void {
    this.events.push({ at: new Date().toISOString(), operation, ...(detail ? { detail } : {}) });
  }

  private async transition(
    operation: string,
    state: MatrixPeerStatus['state'],
    hook?: () => Promise<void>,
  ): Promise<void> {
    this.currentAction = operation;
    this.event(operation, 'started');
    try {
      await hook?.();
      this.state = state;
      this.event(operation, 'completed');
      this.currentAction = undefined;
    } catch (error) {
      this.state = error instanceof MatrixUnavailableError ? 'skipped' : 'failed';
      this.lastError = errorMessage(error);
      this.event(operation, this.lastError);
      throw error;
    }
  }

  prepare(): Promise<void> { return this.transition('prepare', 'prepared', this.hooks.prepare); }
  install(): Promise<void> { return this.transition('install', 'installed', this.hooks.install); }
  reset(): Promise<void> { return this.transition('reset', 'prepared', this.hooks.reset); }
  start(): Promise<void> { return this.transition('start', 'running', this.hooks.start); }
  async stop(): Promise<void> {
    const terminalState = this.state === 'failed' || this.state === 'skipped' ? this.state : 'stopped';
    await this.transition('stop', terminalState, this.hooks.stop);
  }

  async executeScenarioAction(action: MatrixScenarioAction): Promise<MatrixCommandResult | void> {
    this.currentAction = action.description;
    this.event(`action:${action.kind}`, action.description);
    try {
      const result = await this.hooks.execute(action);
      if (result) {
        this.commandResults.push(result);
        if (result.exitCode !== 0) throw new Error(result.stderr || `command exited ${result.exitCode}`);
      }
      this.currentAction = undefined;
      return result;
    } catch (error) {
      this.state = 'failed';
      this.lastError = errorMessage(error);
      this.event(`action:${action.kind}:failed`, this.lastError);
      throw error;
    }
  }

  async collectLogs(): Promise<MatrixArtifact[]> {
    fs.mkdirSync(this.artifactDirectory, { recursive: true });
    const logPath = path.join(this.artifactDirectory, `${this.peer.id}.log.json`);
    fs.writeFileSync(logPath, `${JSON.stringify({ peer: this.peer, events: this.events, commandResults: this.commandResults }, null, 2)}\n`);
    return [{ kind: 'log', path: logPath, peerId: this.peer.id }];
  }

  async screenshot(): Promise<MatrixArtifact[]> {
    const screenshots = await this.hooks.screenshots?.() ?? [];
    return screenshots.map((screenshotPath) => ({
      kind: 'screenshot' as const,
      path: screenshotPath,
      peerId: this.peer.id,
    }));
  }

  async reportStatus(): Promise<MatrixPeerStatus> {
    return {
      peer: this.peer,
      state: this.state,
      ...(this.currentAction ? { currentAction: this.currentAction } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      updatedAt: new Date().toISOString(),
    };
  }
}

export type MatrixRunResult = {
  scenario: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  passed: boolean;
  skipped?: boolean;
  topology: MatrixPeerMetadata[];
  statuses: MatrixPeerStatus[];
  artifacts: MatrixArtifact[];
  failure?: {
    peerId: string;
    hostOrDevice: string;
    action: string;
    otherPeerObservations: string;
    category: MatrixFailureCategory;
    availableArtifacts: string[];
    detail: string;
  };
};

export function writeMatrixResult(
  result: MatrixRunResult,
  outputDirectory: string,
): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, 'matrix-result.json');
  const markdownPath = path.join(outputDirectory, 'summary.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const rows = result.topology.map((peer) => {
    const status = result.statuses.find((entry) => entry.peer.id === peer.id);
    return `| ${peer.id} | ${peer.platform} | ${peer.browser ?? peer.kind} | ${peer.physicalDevice ?? 'virtual'} | ${status?.state ?? 'unknown'} |`;
  });
  const failure = result.failure
    ? `\n## Failure diagnostics\n\n- Peer: ${result.failure.peerId}\n- Host/device: ${result.failure.hostOrDevice}\n- Action: ${result.failure.action}\n- Other peers: ${result.failure.otherPeerObservations}\n- Category: ${result.failure.category}\n- Artifacts: ${result.failure.availableArtifacts.join(', ') || 'none'}\n- Detail: ${result.failure.detail}\n`
    : '';
  fs.writeFileSync(markdownPath, [
    `# Matrix result: ${result.scenario}`,
    '',
    `Result: **${result.passed ? 'PASS' : 'FAIL'}**`,
    `Duration: ${result.durationMs} ms`,
    '',
    '| Peer | OS | Browser/type | Physical device | Status |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    failure,
  ].join('\n'));
  return { jsonPath, markdownPath };
}
