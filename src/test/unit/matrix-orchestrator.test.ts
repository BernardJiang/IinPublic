import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StandardMatrixPeerAdapter,
  classifyMatrixFailure,
  writeMatrixResult,
  type MatrixRunResult,
} from '../support/matrix-orchestrator';

describe('cross-platform matrix orchestrator', () => {
  test('every adapter exposes and records the standardized lifecycle', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-matrix-adapter-'));
    const calls: string[] = [];
    const adapter = new StandardMatrixPeerAdapter(
      { id: 'alice', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'firefox' },
      directory,
      {
        prepare: async () => { calls.push('prepare'); },
        install: async () => { calls.push('install'); },
        reset: async () => { calls.push('reset'); },
        start: async () => { calls.push('start'); },
        stop: async () => { calls.push('stop'); },
        execute: async (action) => {
          calls.push(`action:${action.kind}`);
          return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 4 };
        },
        screenshots: async () => ['/tmp/failure.png'],
      },
    );

    await adapter.prepare();
    await adapter.install();
    await adapter.reset();
    await adapter.start();
    await adapter.executeScenarioAction({ kind: 'create-talk', description: 'Alice creates a Talk' });
    await adapter.stop();

    expect(calls).toEqual(['prepare', 'install', 'reset', 'start', 'action:create-talk', 'stop']);
    await expect(adapter.reportStatus()).resolves.toMatchObject({ state: 'stopped', peer: { id: 'alice' } });
    await expect(adapter.screenshot()).resolves.toEqual([
      { kind: 'screenshot', path: '/tmp/failure.png', peerId: 'alice' },
    ]);
    const logs = await adapter.collectLogs();
    expect(logs).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(logs[0].path, 'utf8'))).toMatchObject({
      peer: { id: 'alice' },
      commandResults: [{ exitCode: 0, stdout: 'ok' }],
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('writes one machine-readable result and a grouped human summary with complete diagnostics', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-matrix-report-'));
    const result: MatrixRunResult = {
      scenario: 'mixed-runtime',
      startedAt: '2026-09-18T00:00:00.000Z',
      finishedAt: '2026-09-18T00:00:01.000Z',
      durationMs: 1000,
      passed: false,
      topology: [
        { id: 'alice', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'firefox' },
        { id: 'bob', host: 'phone', platform: 'android', kind: 'android-app', physicalDevice: 'Pixel' },
      ],
      statuses: [
        { peer: { id: 'alice', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'firefox' }, state: 'failed', updatedAt: '2026-09-18T00:00:01.000Z' },
        { peer: { id: 'bob', host: 'phone', platform: 'android', kind: 'android-app', physicalDevice: 'Pixel' }, state: 'running', updatedAt: '2026-09-18T00:00:01.000Z' },
      ],
      artifacts: [{ kind: 'trace', path: '/tmp/trace.zip', peerId: 'alice' }],
      failure: {
        peerId: 'alice', hostOrDevice: 'localhost', action: 'send Talk',
        otherPeerObservations: 'Bob stayed online but received nothing.', category: 'synchronization',
        availableArtifacts: ['/tmp/trace.zip'], detail: 'state did not converge',
      },
    };
    const paths = writeMatrixResult(result, directory);
    expect(JSON.parse(fs.readFileSync(paths.jsonPath, 'utf8'))).toEqual(result);
    const markdown = fs.readFileSync(paths.markdownPath, 'utf8');
    expect(markdown).toContain('| alice | macos | firefox | virtual | failed |');
    expect(markdown).toContain('Other peers: Bob stayed online but received nothing.');
    expect(markdown).toContain('Category: synchronization');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test.each([
    ['locator was not visible', 'ui'],
    ['WebSocket ECONNRESET', 'network'],
    ['peer discovery timed out', 'discovery'],
    ['IndexedDB persistence failed', 'persistence'],
    ['state did not converge', 'synchronization'],
    ['dependency installation failed', 'infrastructure'],
  ])('classifies %s as %s', (detail, category) => {
    expect(classifyMatrixFailure(detail)).toBe(category);
  });
});
