import { deriveGunHubUrlFromLocation } from '../../web/services/web-gun-service';

describe('deriveGunHubUrlFromLocation', () => {
  it('applies the dev/e2e offset for web port 3001 (slot 0)', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '3001')).toBe('http://127.0.0.1:8080/gun');
  });

  it('applies the dev/e2e offset for a parallel worker (web 3007 -> gun 8086)', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '3007')).toBe('http://127.0.0.1:8086/gun');
  });

  it('applies the dev/e2e offset for "localhost" as well as 127.0.0.1', () => {
    expect(deriveGunHubUrlFromLocation('http:', 'localhost', '3002')).toBe('http://localhost:8081/gun');
  });

  // S3 embedded-node regression: before this fix, any localhost port >= 3001
  // (including embedded-node's own default ports) fell into the dev/e2e
  // offset branch and computed a Gun URL on a port nothing is listening on.
  it('embedded-node default port 8080 resolves to itself (same-origin), not the dev/e2e offset', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '8080')).toBe('http://127.0.0.1:8080/gun');
  });

  it('embedded-node desktop/mobile port 8088 resolves to itself (same-origin)', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '8088')).toBe('http://127.0.0.1:8088/gun');
  });

  it('an arbitrary high localhost port (e.g. a custom embedded-node port) resolves same-origin', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '19932')).toBe('http://127.0.0.1:19932/gun');
  });

  it('falls back to :8080 for localhost with no port', () => {
    expect(deriveGunHubUrlFromLocation('http:', '127.0.0.1', '')).toBe('http://127.0.0.1:8080/gun');
  });

  it('non-localhost (prod) hostname resolves same-origin with no explicit port', () => {
    expect(deriveGunHubUrlFromLocation('https:', 'www.iinpublic.com', '')).toBe('https://www.iinpublic.com/gun');
  });
});
