import { PeerHeadshotCache } from '../../web/ui/peer-headshot-cache';

const OLD = 'data:image/jpeg;base64,AAAA';
const NEW = 'data:image/jpeg;base64,BBBB';

function setup(ttl = 1000) {
  let time = 1_000_000;
  const cache = new PeerHeadshotCache(ttl, () => time);
  return { cache, advance: (ms: number) => (time += ms) };
}

describe('PeerHeadshotCache', () => {
  it('serves a fresh entry without re-reading', async () => {
    const { cache, advance } = setup();
    const reader = jest.fn(async () => ({ headshot: OLD }));
    expect(await cache.resolve('p', reader)).toBe(OLD);
    advance(999);
    expect(await cache.resolve('p', reader)).toBe(OLD);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(cache.get('p')).toBe(OLD);
  });

  it('re-reads after the TTL so a peer\'s newly set photo appears without a reload', async () => {
    const { cache, advance } = setup();
    let value: string | null = null;
    const reader = jest.fn(async () => ({ headshot: value }));
    expect(await cache.resolve('p', reader)).toBeNull(); // no photo yet
    value = NEW;
    expect(await cache.resolve('p', reader)).toBeNull(); // still inside the TTL
    advance(1001);
    expect(await cache.resolve('p', reader)).toBe(NEW);
    expect(cache.get('p')).toBe(NEW);
  });

  it('picks up a removed photo after the TTL', async () => {
    const { cache, advance } = setup();
    let value: string | null = OLD;
    const reader = async () => ({ headshot: value });
    await cache.resolve('p', reader);
    value = null;
    advance(1001);
    expect(await cache.resolve('p', reader)).toBeNull();
    expect(cache.get('p')).toBeNull();
  });

  it('a failed refresh keeps the good cached photo instead of downgrading it to none', async () => {
    const { cache, advance } = setup();
    await cache.resolve('p', async () => ({ headshot: OLD }));
    advance(1001);
    const failing = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await cache.resolve('p', failing)).toBe(OLD);
    expect(cache.get('p')).toBe(OLD);
    // ...and it does not hammer the failing reader on every render: the failure re-arms the TTL.
    await cache.resolve('p', failing);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('a failure with nothing cached records "no photo" rather than throwing', async () => {
    const { cache } = setup();
    expect(await cache.resolve('p', async () => { throw new Error('x'); })).toBeNull();
    expect(cache.get('p')).toBeNull();
  });

  it('deduplicates concurrent resolves for one peer into a single read', async () => {
    const { cache } = setup();
    let release!: (v: { headshot: string }) => void;
    const reader = jest.fn(() => new Promise<{ headshot: string }>((resolve) => { release = resolve; }));
    const a = cache.resolve('p', reader);
    const b = cache.resolve('p', reader);
    release({ headshot: OLD });
    expect(await Promise.all([a, b])).toEqual([OLD, OLD]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('with no reader configured it returns whatever is cached (or null) and never throws', async () => {
    const { cache } = setup();
    expect(await cache.resolve('p', undefined)).toBeNull();
    await cache.resolve('q', async () => ({ headshot: OLD }));
    expect(await cache.resolve('q', undefined)).toBe(OLD);
  });
});
