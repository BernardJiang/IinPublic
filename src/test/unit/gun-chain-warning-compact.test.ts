import { compactGunChainWarnings } from '../../server/logger';

describe('compactGunChainWarnings', () => {
  it('turns Gun\'s root-graph dump into one short line, at most one per interval, with a count', () => {
    const lines: unknown[][] = [];
    const target = { log: (...args: unknown[]) => { lines.push(args); } };
    let now = 0;
    compactGunChainWarnings(target, () => now, 10_000);
    const put = { '#': 'p2p-signal/abc', '.': 'p2p_1_x', ':': { '#': 'p2p-signal/abc/p2p_1_x' }, '>': undefined };
    const hugeRoot = { root: { graph: { a: 1 } } };

    target.log('chain not yet supported for', put, '...', { put }, hugeRoot);
    target.log('chain not yet supported for', put, '...', { put }, hugeRoot);
    target.log('chain not yet supported for', put, '...', { put }, hugeRoot);
    now = 10_000;
    target.log('chain not yet supported for', { '#': 'p2p-signal/def', '.': 'k' }, '...', {}, hugeRoot);
    target.log('other', 1);

    expect(lines).toEqual([
      ['[gun] chain not yet supported for p2p-signal/abc . p2p_1_x'],
      ['[gun] chain not yet supported for p2p-signal/def . k (+2 more)'],
      ['other', 1],
    ]);
  });
});
