import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import { createFallbackMeshSession } from '../../web/services/p2p-mesh-session-fallback';

type MeshSession = {
  ensureConnected: jest.Mock<Promise<void>, []>;
  sendMeshFrame: jest.Mock<Promise<void>, [P2PMeshFrame]>;
  setOnRemoteMeshFrame: jest.Mock<void, [(otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>]>;
  dispose: jest.Mock<void, []>;
};

function makeFrame(): P2PMeshFrame {
  return {
    version: 1,
    kind: 'mesh-ping',
    msgId: 'msg',
    roomId: 'global',
    originUserId: 'alice',
    originPub: 'pub-alice',
    createdAt: new Date().toISOString(),
    ttlHops: 6,
    payload: { text: 'ping' },
  };
}

function makeSession(): MeshSession {
  return {
    ensureConnected: jest.fn(async () => undefined),
    sendMeshFrame: jest.fn(async (_frame: P2PMeshFrame) => undefined),
    setOnRemoteMeshFrame: jest.fn(),
    dispose: jest.fn(),
  };
}

describe('createFallbackMeshSession', () => {
  test('uses primary when healthy', async () => {
    const primary = makeSession();
    const fallback = makeSession();

    const session = createFallbackMeshSession({
      primaryFactory: () => primary,
      fallbackFactory: () => fallback,
    });

    await session.ensureConnected();
    await session.sendMeshFrame(makeFrame());

    expect(primary.ensureConnected).toHaveBeenCalledTimes(1);
    expect(primary.sendMeshFrame).toHaveBeenCalledTimes(1);
    expect(fallback.ensureConnected).not.toHaveBeenCalled();
    expect(fallback.sendMeshFrame).not.toHaveBeenCalled();
  });

  test('falls back on connect error', async () => {
    const primary = makeSession();
    primary.ensureConnected.mockRejectedValueOnce(new Error('primary-connect-fail'));
    const fallback = makeSession();

    const onFallback = jest.fn();
    const session = createFallbackMeshSession({
      primaryFactory: () => primary,
      fallbackFactory: () => fallback,
      onFallback,
    });

    await session.ensureConnected();

    expect(onFallback).toHaveBeenCalledWith('connect', expect.any(Error));
    expect(fallback.ensureConnected).toHaveBeenCalledTimes(1);
  });

  test('falls back on send error and retries send through fallback', async () => {
    const primary = makeSession();
    primary.sendMeshFrame.mockRejectedValueOnce(new Error('primary-send-fail'));
    const fallback = makeSession();

    const onFallback = jest.fn();
    const session = createFallbackMeshSession({
      primaryFactory: () => primary,
      fallbackFactory: () => fallback,
      onFallback,
    });

    const frame = makeFrame();
    await session.sendMeshFrame(frame);

    expect(onFallback).toHaveBeenCalledWith('send', expect.any(Error));
    expect(fallback.ensureConnected).toHaveBeenCalledTimes(1);
    expect(fallback.sendMeshFrame).toHaveBeenCalledWith(frame);
  });

  test('disposes both sessions if created', () => {
    const primary = makeSession();
    const fallback = makeSession();
    const session = createFallbackMeshSession({
      primaryFactory: () => primary,
      fallbackFactory: () => fallback,
    });

    session.setOnRemoteMeshFrame(() => undefined);
    session.dispose?.();

    expect(primary.dispose).toHaveBeenCalledTimes(1);
    expect(fallback.dispose).not.toHaveBeenCalled();
  });
});
