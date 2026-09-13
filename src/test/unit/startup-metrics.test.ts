/** @jest-environment jsdom */

import {
  markStartupPhase,
  startupMetricsSnapshot,
} from '../../web/performance/startup-metrics';

describe('startup metrics', () => {
  beforeEach(() => {
    delete window.__iinpublicStartupMetrics;
    delete window.iinpublicNative;
    window.history.replaceState({}, '', '/');
  });

  it('records each browser-relative phase once', () => {
    markStartupPhase('bundleExecuted');
    const first = startupMetricsSnapshot().phases.bundleExecuted;
    markStartupPhase('bundleExecuted');

    expect(first).toEqual(expect.any(Number));
    expect(startupMetricsSnapshot().phases.bundleExecuted).toBe(first);
  });

  it('reads browser-host launch milestones from the URL', () => {
    window.history.replaceState(
      {},
      '',
      '/?perf_process_launch_ms=1000&perf_node_health_ready_ms=1400',
    );

    expect(startupMetricsSnapshot().host).toEqual({
      processLaunchEpochMs: 1000,
      nodeHealthReadyEpochMs: 1400,
    });
  });

  it('prefers Electron preload milestones over URL fallbacks', () => {
    window.history.replaceState({}, '', '/?perf_process_launch_ms=1000');
    window.iinpublicNative = {
      startup: { processLaunchEpochMs: 2000, nodeHealthReadyEpochMs: 2400 },
    };

    expect(startupMetricsSnapshot().host).toEqual({
      processLaunchEpochMs: 2000,
      nodeHealthReadyEpochMs: 2400,
    });
  });
});
