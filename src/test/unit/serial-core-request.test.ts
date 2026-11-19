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
