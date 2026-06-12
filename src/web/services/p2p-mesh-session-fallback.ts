import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';

type MeshSession = {
  ensureConnected: () => Promise<void>;
  sendMeshFrame: (frame: P2PMeshFrame) => Promise<void>;
  setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => void;
  dispose?: () => void;
};

type MeshSessionFactory = () => MeshSession;

/**
 * Wrap two mesh sessions where primary is preferred and fallback is activated on first error.
 */
export function createFallbackMeshSession(params: {
  primaryFactory: MeshSessionFactory;
  fallbackFactory: MeshSessionFactory;
  onFallback?: (cause: 'connect' | 'send', error: unknown) => void;
}): MeshSession {
  let primary: MeshSession | null = null;
  let fallback: MeshSession | null = null;
  let fallbackActive = false;

  const ensurePrimary = (): MeshSession => {
    if (!primary) primary = params.primaryFactory();
    return primary;
  };

  const ensureFallback = (): MeshSession => {
    if (!fallback) fallback = params.fallbackFactory();
    return fallback;
  };

  const activateFallback = (cause: 'connect' | 'send', error: unknown): MeshSession => {
    fallbackActive = true;
    params.onFallback?.(cause, error);
    return ensureFallback();
  };

  return {
    async ensureConnected(): Promise<void> {
      if (fallbackActive) {
        await ensureFallback().ensureConnected();
        return;
      }
      try {
        await ensurePrimary().ensureConnected();
      } catch (error) {
        const session = activateFallback('connect', error);
        await session.ensureConnected();
      }
    },

    async sendMeshFrame(frame: P2PMeshFrame): Promise<void> {
      if (fallbackActive) {
        await ensureFallback().sendMeshFrame(frame);
        return;
      }
      try {
        await ensurePrimary().sendMeshFrame(frame);
      } catch (error) {
        const session = activateFallback('send', error);
        await session.ensureConnected();
        await session.sendMeshFrame(frame);
      }
    },

    setOnRemoteMeshFrame(hook): void {
      ensurePrimary().setOnRemoteMeshFrame(hook);
      if (fallback) fallback.setOnRemoteMeshFrame(hook);
    },

    dispose(): void {
      primary?.dispose?.();
      fallback?.dispose?.();
    },
  };
}
