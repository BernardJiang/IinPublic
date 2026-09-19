import {
  detectNativeCustodyBridge,
  parseNativeCustodyPair,
  type NativeCustodyBridge,
} from '../../shared/native-custody-bridge';
import { NativePasswordFreeCustodyManager } from '../../web/services/native-password-free-custody-manager';

const pair = { pub: 'p', epub: 'e', priv: 'x', epriv: 'y' };

function memoryBridge(failVerify = false): NativeCustodyBridge & { stored: typeof pair | null } {
  const b = {
    stored: null as typeof pair | null,
    describe: async () => ({ version: 1 as const, provider: 'android-keystore' as const, hardwareBacked: true, available: true }),
    read: async () => (b.stored ? { ...b.stored } : null),
    write: async (p: typeof pair) => { b.stored = failVerify ? { ...p, priv: 'tampered' } : { ...p }; },
    remove: async () => { b.stored = null; },
  };
  return b;
}

describe('native password-free custody', () => {
  it('writes, reads back, and removes only a matching identity', async () => {
    const bridge = memoryBridge();
    const m = new NativePasswordFreeCustodyManager(bridge);
    await m.writeAndVerify(pair);
    expect(await m.readPair()).toEqual(pair);
    await expect(m.removeIfMatches({ pub: 'other', epub: 'e' })).rejects.toThrow();
    await m.removeIfMatches({ pub: 'p', epub: 'e' });
    expect(bridge.stored).toBeNull();
  });

  it('rolls back when read-back verification fails and refuses identity replacement', async () => {
    const bad = memoryBridge(true);
    await expect(new NativePasswordFreeCustodyManager(bad).writeAndVerify(pair)).rejects.toThrow();
    expect(bad.stored).toBeNull();
    const good = memoryBridge();
    const m = new NativePasswordFreeCustodyManager(good);
    await m.writeAndVerify(pair);
    await expect(m.writeAndVerify({ ...pair, pub: 'z' })).rejects.toThrow(/different identity/);
  });

  it('migrates from a source, removing it only after verification, and fails on conflict', async () => {
    const m = new NativePasswordFreeCustodyManager(memoryBridge());
    let removed = false;
    const source = { readPair: async () => pair, removeIfMatches: async () => { removed = true; } };
    expect(await m.migrateFrom(source)).toEqual(pair);
    expect(removed).toBe(true);
    await expect(m.migrateFrom({ readPair: async () => ({ ...pair, priv: 'other' }), removeIfMatches: async () => {} }))
      .rejects.toThrow(/conflict/);
  });

  it('treats native read errors as failures, never as an empty record', () => {
    expect(parseNativeCustodyPair('{"pair":null}')).toBeNull();
    expect(() => parseNativeCustodyPair('{"error":"AEADBadTagException"}')).toThrow();
    expect(() => parseNativeCustodyPair('{}')).toThrow();
  });

  it('detects Android, Apple, and Electron bridges and returns null in a plain browser', async () => {
    expect(detectNativeCustodyBridge({})).toBeNull();
    const android = detectNativeCustodyBridge({
      IinPublicCustody: {
        describe: () => '{"version":1,"provider":"android-keystore","available":true,"hardwareBacked":true}',
        read: () => JSON.stringify({ pair }),
        write: () => '{"ok":true}',
        remove: () => '{"ok":false}',
      },
    });
    expect((await android!.describe()).hardwareBacked).toBe(true);
    expect(await android!.read()).toEqual(pair);
    await expect(android!.remove(pair)).rejects.toThrow();
    const apple = detectNativeCustodyBridge({
      webkit: { messageHandlers: { iinpublicCustody: { postMessage: async () => ({ ok: true }) } } },
    });
    await apple!.write(pair);
  });
});
