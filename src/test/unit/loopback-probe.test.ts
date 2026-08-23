/**
 * TODO §I — loopback same-device linking shortcut (spec §10.3). `probeLoopbackNode` is a
 * silent reachability check (never surfaces an error to the caller); `loopbackLinkUrl`
 * builds the URL the one-click affordance opens.
 */

import { probeLoopbackNode, loopbackLinkUrl, DEFAULT_LOOPBACK_PORT } from '../../web/services/loopback-probe';

describe('probeLoopbackNode', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns true when the local node answers /health with an ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    await expect(probeLoopbackNode()).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${DEFAULT_LOOPBACK_PORT}/health`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns false when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    await expect(probeLoopbackNode()).resolves.toBe(false);
  });

  it('returns false (never throws) when fetch rejects — no local node, or CORS-blocked', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    await expect(probeLoopbackNode()).resolves.toBe(false);
  });

  it('returns false when fetch is unavailable', async () => {
    // @ts-expect-error deliberately simulating an environment without fetch
    delete global.fetch;
    await expect(probeLoopbackNode()).resolves.toBe(false);
  });

  it('probes a custom port when given one', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    await probeLoopbackNode(9999);
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/health', expect.anything());
  });
});

describe('loopbackLinkUrl', () => {
  it('builds a loopback #link= URL on the default port', () => {
    expect(loopbackLinkUrl('abc123')).toBe(`http://127.0.0.1:${DEFAULT_LOOPBACK_PORT}/#link=abc123`);
  });

  it('URL-encodes the code', () => {
    expect(loopbackLinkUrl('a b')).toBe(`http://127.0.0.1:${DEFAULT_LOOPBACK_PORT}/#link=a%20b`);
  });

  it('honors a custom port', () => {
    expect(loopbackLinkUrl('abc123', 9999)).toBe('http://127.0.0.1:9999/#link=abc123');
  });
});
