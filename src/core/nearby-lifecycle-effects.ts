/** Race-safe lifecycle for a host-created Nearby runtime. */
export type NearbyLifecycleState = 'stopped' | 'starting' | 'running';

export type NearbyLifecycleEvent =
  | { type: 'state'; state: NearbyLifecycleState }
  | { type: 'start-failed'; error: unknown }
  | { type: 'refresh-failed'; error: unknown };

export interface NearbyLifecycleEffectsPorts<Runtime> {
  /** Stable identity for the runtime that may run now; null means Nearby is ineligible. */
  identityKey(): string | null;
  createRuntime(identityKey: string): Promise<Runtime | null>;
  startRuntime(runtime: Runtime): void;
  stopRuntime(runtime: Runtime): void;
  refreshRuntime(runtime: Runtime): Promise<unknown> | void;
  onEvent?(event: NearbyLifecycleEvent): void;
}

export class NearbyLifecycleEffects<Runtime> {
  private runtime: Runtime | null = null;
  private stateValue: NearbyLifecycleState = 'stopped';
  private generation = 0;
  private startPromise: Promise<Runtime | null> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private refreshQueued = false;

  constructor(private readonly ports: NearbyLifecycleEffectsPorts<Runtime>) {}

  state(): NearbyLifecycleState {
    return this.stateValue;
  }

  current(): Runtime | null {
    return this.runtime;
  }

  private setState(state: NearbyLifecycleState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.ports.onEvent?.({ type: 'state', state });
  }

  start(): Promise<Runtime | null> {
    if (this.runtime) return Promise.resolve(this.runtime);
    if (this.startPromise) return this.startPromise;
    const identityKey = this.ports.identityKey();
    if (!identityKey) return Promise.resolve(null);
    const generation = this.generation;
    this.setState('starting');

    const start = (async () => {
      try {
        const runtime = await this.ports.createRuntime(identityKey);
        if (!runtime) return null;
        if (generation !== this.generation || this.ports.identityKey() !== identityKey) {
          this.ports.stopRuntime(runtime);
          return null;
        }
        this.runtime = runtime;
        try {
          this.ports.startRuntime(runtime);
        } catch (error) {
          this.runtime = null;
          this.ports.stopRuntime(runtime);
          throw error;
        }
        this.setState('running');
        return runtime;
      } catch (error) {
        this.ports.onEvent?.({ type: 'start-failed', error });
        return null;
      } finally {
        this.startPromise = null;
        if (!this.runtime) {
          this.refreshQueued = false;
          this.setState('stopped');
        }
        if (this.runtime && this.refreshQueued) void this.refresh();
      }
    })();
    this.startPromise = start;
    return start;
  }

  stop(): void {
    this.generation += 1;
    this.refreshQueued = false;
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime) this.ports.stopRuntime(runtime);
    this.setState('stopped');
  }

  refresh(): Promise<void> {
    this.refreshQueued = true;
    if (!this.runtime) {
      // Preserve one refresh requested while an async start is choosing identity/mesh.
      if (!this.startPromise) this.refreshQueued = false;
      return Promise.resolve();
    }
    if (this.refreshPromise) return this.refreshPromise;
    const runtime = this.runtime;
    const refresh = (async () => {
      while (this.refreshQueued && this.runtime === runtime) {
        this.refreshQueued = false;
        try {
          await this.ports.refreshRuntime(runtime);
        } catch (error) {
          this.ports.onEvent?.({ type: 'refresh-failed', error });
        }
      }
    })().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = refresh;
    return refresh;
  }
}
