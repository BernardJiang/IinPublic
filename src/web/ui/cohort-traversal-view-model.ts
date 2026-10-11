/**
 * UI-facing state for moving between capacity groups that cover the same Nearby area.
 *
 * The view model deliberately exposes no room, identity-lane, or coordinate identifiers. The
 * protocol/client owners can replace this local model later without leaking allocation details
 * into the interface.
 */
export type CohortTraversalStatus =
  | 'ready'
  | 'visiting'
  | 'returning'
  | 'full'
  | 'offline'
  | 'error';

export type CohortTraversalSnapshot = {
  status: CohortTraversalStatus;
  isDefaultGroup: boolean;
  /** Aggregate count only. Individual capacity groups are not map destinations. */
  groupCount?: number;
};

export interface CohortTraversalViewModel {
  getSnapshot(): CohortTraversalSnapshot;
  meetAnotherGroup(): Promise<void>;
  returnToDefaultGroup(): Promise<void>;
}

export function isCohortTraversalPending(status: CohortTraversalStatus): boolean {
  return status === 'visiting' || status === 'returning';
}

export type LocalCohortTraversalOutcome = 'success' | 'full' | 'offline' | 'error';

export type LocalCohortTraversalViewModel = CohortTraversalViewModel & {
  setGroupCount(groupCount: number | undefined): void;
  setOnline(online: boolean): void;
  setNextOutcome(outcome: LocalCohortTraversalOutcome): void;
};

type LocalCohortTraversalOptions = {
  groupCount?: number;
  isDefaultGroup?: boolean;
  online?: boolean;
};

/**
 * Local, non-networked model used by the Group 1 UI shell and its component tests.
 *
 * It models the interaction states without claiming that a real room handoff happened. The
 * shipping shell starts with one known group, so its visit action stays disabled until the Group
 * 2 client supplies real eligible-group summaries. Tests and story-like consumers can raise the
 * aggregate count and select an outcome to exercise the complete UI state machine.
 */
export function createLocalCohortTraversalViewModel(
  options: LocalCohortTraversalOptions = {},
): LocalCohortTraversalViewModel {
  let groupCount = normalizeGroupCount(options.groupCount ?? 1);
  let isDefaultGroup = options.isDefaultGroup ?? true;
  let online = options.online ?? true;
  let status: CohortTraversalStatus = online ? 'ready' : 'offline';
  let nextOutcome: LocalCohortTraversalOutcome = 'success';

  const run = async (action: 'visit' | 'return'): Promise<void> => {
    if (!online) {
      status = 'offline';
      return;
    }
    if (action === 'visit' && (groupCount ?? 0) <= 1) {
      status = 'ready';
      return;
    }

    status = action === 'visit' ? 'visiting' : 'returning';
    // Leave one microtask between pending and outcome so the renderer can expose aria-busy.
    await Promise.resolve();

    const outcome = nextOutcome;
    nextOutcome = 'success';
    if (outcome === 'success') {
      isDefaultGroup = action === 'return';
      status = 'ready';
      return;
    }
    status = outcome;
  };

  return {
    getSnapshot: () => ({
      status,
      isDefaultGroup,
      ...(groupCount === undefined ? {} : { groupCount }),
    }),
    meetAnotherGroup: () => run('visit'),
    returnToDefaultGroup: () => run('return'),
    setGroupCount: (value) => {
      groupCount = normalizeGroupCount(value);
    },
    setOnline: (value) => {
      online = value;
      status = online ? 'ready' : 'offline';
    },
    setNextOutcome: (outcome) => {
      nextOutcome = outcome;
    },
  };
}

function normalizeGroupCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}
