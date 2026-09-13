export type StartupPhase =
  | 'htmlParsed'
  | 'bundleExecuted'
  | 'domContentLoaded'
  | 'firstUsableNavigation'
  | 'initialSyncComplete';

export type StartupMetrics = {
  version: 1;
  host: {
    processLaunchEpochMs?: number;
    nodeHealthReadyEpochMs?: number;
  };
  phases: Partial<Record<StartupPhase, number>>;
};

declare global {
  interface Window {
    __iinpublicStartupMetrics?: StartupMetrics;
    iinpublicNative?: {
      startup?: {
        processLaunchEpochMs?: number;
        nodeHealthReadyEpochMs?: number;
      };
    };
  }
}

function finiteEpoch(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hostStartupMetrics(): StartupMetrics['host'] {
  const query = new URLSearchParams(window.location.search);
  const native = window.iinpublicNative?.startup;
  const processLaunchEpochMs = finiteEpoch(
    native?.processLaunchEpochMs ?? query.get('perf_process_launch_ms'),
  );
  const nodeHealthReadyEpochMs = finiteEpoch(
    native?.nodeHealthReadyEpochMs ?? query.get('perf_node_health_ready_ms'),
  );
  return {
    ...(processLaunchEpochMs ? { processLaunchEpochMs } : {}),
    ...(nodeHealthReadyEpochMs ? { nodeHealthReadyEpochMs } : {}),
  };
}

function metrics(): StartupMetrics {
  const current = window.__iinpublicStartupMetrics;
  if (current?.version === 1) {
    current.host = { ...current.host, ...hostStartupMetrics() };
    return current;
  }
  const created: StartupMetrics = { version: 1, host: hostStartupMetrics(), phases: {} };
  window.__iinpublicStartupMetrics = created;
  return created;
}

/** Record each startup milestone once, as milliseconds from Performance.timeOrigin. */
export function markStartupPhase(phase: StartupPhase): void {
  const state = metrics();
  if (state.phases[phase] !== undefined) return;
  const at = performance.now();
  state.phases[phase] = at;
  try {
    performance.mark(`iinpublic:${phase}`, { startTime: at });
  } catch {
    // Older WebViews support performance.now() but not mark options.
    try { performance.mark(`iinpublic:${phase}`); } catch { /* diagnostics only */ }
  }
}

export function startupMetricsSnapshot(): StartupMetrics {
  const state = metrics();
  return {
    version: 1,
    host: { ...state.host },
    phases: { ...state.phases },
  };
}
