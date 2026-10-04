import { WebGunService } from '../../web/services/web-gun-service';

/** Scripted WebSocket: each construction pops the next outcome ('open' | 'error'). */
class FakeSocket {
  static outcomes: Array<'open' | 'error'> = [];
  static urls: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    FakeSocket.urls.push(url);
    const outcome = FakeSocket.outcomes.shift() ?? 'error';
    setTimeout(() => (outcome === 'open' ? this.onopen?.() : this.onerror?.()), 0);
  }
  close(): void { /* no-op */ }
}

function fakeService() {
  const opt = jest.fn();
  const emit = jest.fn();
  const self = { gun: { _: { opt: { peers: {} as Record<string, unknown> } }, opt }, pendingPeerProbes: new Set<string>(), emit };
  const addPeer = (url: string, probe?: { attempts?: number; intervalMs?: number }) =>
    (WebGunService.prototype.addPeer as (this: unknown, url: string, probe?: unknown) => void).call(self, url, probe);
  return { self, opt, emit, addPeer };
}

describe('WebGunService.addPeer (OPEN-36 offline peers)', () => {
  const realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.outcomes = [];
    FakeSocket.urls = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  });
  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { WebSocket?: unknown }).WebSocket = realWebSocket;
  });

  it('hands the peer to Gun only once a probe connects', async () => {
    const { opt, emit, addPeer } = fakeService();
    FakeSocket.outcomes = ['error', 'error', 'open'];
    addPeer('http://192.168.49.1:8088/gun', { intervalMs: 1_000 });
    await jest.advanceTimersByTimeAsync(0);
    expect(opt).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(900);
    expect(opt).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_100);
    expect(opt).toHaveBeenCalledTimes(1);
    expect(opt).toHaveBeenCalledWith({ peers: ['http://192.168.49.1:8088/gun'] });
    expect(FakeSocket.urls).toHaveLength(3);
    expect(emit).toHaveBeenCalledWith('peer-added', 'http://192.168.49.1:8088/gun');
    expect(FakeSocket.urls[0]).toBe('ws://192.168.49.1:8088/gun');
  });

  it('gives the peer to Gun anyway after the last attempt, and dedupes concurrent adds', async () => {
    const { opt, emit, addPeer } = fakeService();
    addPeer('http://192.168.10.71:8088/gun', { attempts: 2, intervalMs: 500 });
    addPeer('http://192.168.10.71:8088/gun', { attempts: 2, intervalMs: 500 });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(opt).toHaveBeenCalledTimes(1);
    expect(FakeSocket.urls).toHaveLength(2);
    // Never answered: still handed to Gun, but no "new peer" announcement.
    expect(emit).not.toHaveBeenCalled();
  });
});
