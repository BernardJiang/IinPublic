/**
 * The indexed read interests (five-phone starter tags, 2026-11-21) answer exactly what a scan of
 * every interest answered, and stay fast with thousands of open leases: every Gun read leaves a
 * 30 s lease, and a scan per read and per incoming field kept a phone's node at 100 % CPU.
 */
import { SharingInterests } from '../../core/sharing-interests';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A Gun chain for `path` (a map adds a step without a key). */
function chain(path: string[], map: boolean): any {
  const root: any = {};
  root.root = root;
  let at: any = { root, back: root, get: path[0], soul: path[0] };
  for (const key of path.slice(1)) at = { root, back: at, get: key };
  if (map) at = { root, back: at };
  return { _: at };
}

type Plain = { path: string; descendants: boolean; expires: number };
function scan(entries: Plain[], now: number, soul: string, field: string): boolean {
  for (const entry of entries) {
    if (entry.expires <= now) continue;
    if (entry.path === soul || (entry.descendants && soul.startsWith(`${entry.path}/`))) return true;
    if (entry.path.startsWith(`${soul}/`) && entry.path.slice(soul.length + 1).split('/')[0] === field) return true;
  }
  return false;
}

describe('indexed read interests', () => {
  it('answer exactly what a scan of every interest answers, as leases come and expire', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    const word = () => ['a', 'b', 'c', 'local', 'ix', 'p2p-signal'][rand(6)]!;
    let now = 0;
    const policy = new SharingInterests(() => now);
    const plain: Plain[] = [];
    const releases: Array<{ release: () => void; entry: Plain }> = [];
    for (let step = 0; step < 4000; step++) {
      now += rand(50);
      const kind = rand(10);
      if (kind < 4) {
        const path = Array.from({ length: 1 + rand(4) }, word);
        const map = rand(3) === 0;
        const once = rand(2) === 0;
        const release = policy.add(chain(path, map), () => {}, once);
        const entry = { path: path.join('/'), descendants: map, expires: once ? now + 30_000 : Infinity };
        plain.push(entry);
        releases.push({ release, entry });
      } else if (kind === 4 && releases.length) {
        const { release, entry } = releases.splice(rand(releases.length), 1)[0]!;
        release();
        plain.splice(plain.indexOf(entry), 1);
      } else {
        const soul = Array.from({ length: 1 + rand(4) }, word).join('/');
        const field = word();
        expect(policy.acceptsField(soul, field)).toBe(scan(plain, now, soul, field));
      }
    }
  });

  it('stay fast with thousands of open leases', () => {
    const policy = new SharingInterests();
    const started = Date.now();
    for (let i = 0; i < 20_000; i++) {
      policy.add(chain(['local', 'ix', 'answered', `talk-${i}`], false), () => {}, true);
      policy.acceptsField(`local/ix/answered/talk-${i}`, 'v');
      policy.acceptsField('local/ix', 'answered');
      policy.acceptsField('p2p-signal/x', 'frame');
    }
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
