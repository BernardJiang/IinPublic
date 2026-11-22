// Serial core requests wait their turn and still run: callers wait minutes for them, not the 45 s
// they give a request to a dead core (starter-tags spec, 2026-11-18: an answer committed but never
// sent because its commit outwaited the bridge).

import { isSerialCoreRequest, SERIAL_CORE_REQUEST_TIMEOUT_MS } from '../../core/protocol';

describe('isSerialCoreRequest', () => {
  it('names answer commits, outcome records and an answer\'s delivery record', () => {
    expect(isSerialCoreRequest({ name: 'response.commit', input: {} } as any)).toBe(true);
    expect(isSerialCoreRequest({ name: 'graph.recordOutcome' } as any)).toBe(true);
    expect(isSerialCoreRequest({ name: 'delivery.record', input: { objectKind: 'talk-response' } } as any)).toBe(true);
    expect(isSerialCoreRequest({ name: 'delivery.record', input: { objectKind: 'message' } } as any)).toBe(false);
    expect(isSerialCoreRequest({ name: 'graph.pull' } as any)).toBe(false);
    expect(SERIAL_CORE_REQUEST_TIMEOUT_MS).toBeGreaterThan(45_000);
  });
});

describe('serial core requests: one lane per record (five-phone starter tags, 2026-11-21)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCoreHandler } = require('../../core/core-handler');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { memoryGraphStore } = require('../../core/graph-store');
  const record = (objectId: string) => ({ name: 'delivery.record', input: { objectId, recipientId: 'ann', objectKind: 'talk-response', state: 'sent' } });

  it('runs different records side by side and the same record in order', async () => {
    const handle = createCoreHandler(memoryGraphStore(), { allowTestOverrides: true });
    await handle({ name: 'test.slowSerialQueue', ms: 300 });
    let started = Date.now();
    await Promise.all([handle(record('r1')), handle(record('r2')), handle(record('r3'))]);
    const sideBySide = Date.now() - started;
    started = Date.now();
    await Promise.all([handle(record('r4')), handle(record('r4'))]);
    const inOrder = Date.now() - started;
    expect(sideBySide).toBeLessThan(550);
    expect(inOrder).toBeGreaterThanOrEqual(590);
  });
});
