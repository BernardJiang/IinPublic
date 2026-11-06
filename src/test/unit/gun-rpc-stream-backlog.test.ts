import http from 'http';
import type { AddressInfo } from 'net';
import { writeBoundedStream } from '../../server/routes/gun-rpc-routes';

describe('Gun RPC stream backlog (OPEN-100)', () => {
  it('drops a stream whose reader has stopped instead of queueing without limit', async () => {
    const limit = 256 * 1024;
    const chunk = 'x'.repeat(64 * 1024);
    let peakBacklog = 0;
    const closed = new Promise<void>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.flushHeaders();
        res.on('close', () => {
          clearInterval(writer);
          server.close();
          resolve();
        });
        const writer = setInterval(() => {
          writeBoundedStream(res, chunk, limit);
          peakBacklog = Math.max(peakBacklog, res.writableLength);
        }, 1);
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        http.get({ host: '127.0.0.1', port }, (response) => {
          // A frozen WebView: connected, reading nothing.
          response.pause();
          response.on('error', () => undefined);
        }).on('error', () => undefined);
      });
    });

    await closed;
    expect(peakBacklog).toBeLessThanOrEqual(limit + chunk.length * 2);
  }, 30_000);

  it('keeps writing to a reader that keeps up', () => {
    const res = { destroyed: false, destroy: jest.fn(), write: jest.fn(), writableLength: 10 };
    writeBoundedStream(res as never, 'event\n', 1024);
    expect(res.write).toHaveBeenCalledWith('event\n');
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('ignores writes after the stream has gone', () => {
    const res = { destroyed: true, destroy: jest.fn(), write: jest.fn(), writableLength: 0 };
    writeBoundedStream(res as never, 'event\n', 1024);
    expect(res.write).not.toHaveBeenCalled();
  });
});
