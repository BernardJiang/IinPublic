/** @jest-environment jsdom */
/** OPEN-91: smaller app data in the device core behind localStorage-style calls. */
import { appStorage, settingsStorage } from '../../web/services/core-storage';
import { appDataView, settingsView } from '../../web/services/core-views';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';

describe('appStorage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps values in the core, never in localStorage', () => {
    appStorage.setItem('peerNameCache', '{"u1":"Ann"}');
    expect(appStorage.getItem('peerNameCache')).toBe('{"u1":"Ann"}');
    expect(localStorage.getItem('peerNameCache')).toBeNull();
    expect(appDataView.get('peerNameCache')).toBe('{"u1":"Ann"}');
    appStorage.removeItem('peerNameCache');
    expect(appStorage.getItem('peerNameCache')).toBeNull();
  });

  it('a localStorage value is newer (an older app, a test seed): taken into the core and removed', () => {
    appStorage.setItem('iinpublic_talk_intake_filters', '{"old":true}');
    localStorage.setItem('iinpublic_talk_intake_filters', '{"seeded":true}');
    expect(appStorage.getItem('iinpublic_talk_intake_filters')).toBe('{"seeded":true}');
    expect(localStorage.getItem('iinpublic_talk_intake_filters')).toBeNull();
    expect(appStorage.getItem('iinpublic_talk_intake_filters')).toBe('{"seeded":true}');
  });
});

describe('settingsStorage', () => {
  beforeEach(() => localStorage.clear());
  const link = (handle: ReturnType<typeof createCoreHandler>) => ({
    snapshot: (collection: any) => handle({ name: 'collection.snapshot', collection }) as Promise<Record<string, unknown>>,
    upsert: (collection: any, entries: Record<string, unknown>) => handle({ name: 'collection.upsert', collection, entries }),
    remove: (collection: any, keys: string[]) => handle({ name: 'collection.remove', collection, keys }),
  });

  it('before the core loads, reads the start-up copy; writes go to both', () => {
    localStorage.setItem('iinpublic_ui_language', 'zh');
    expect(settingsStorage.getItem('iinpublic_ui_language')).toBe('zh');
    settingsStorage.setItem('iinpublic_color_scheme', 'dark');
    expect(localStorage.getItem('iinpublic_color_scheme')).toBe('dark');
    expect(settingsView.get('iinpublic_color_scheme')).toBe('dark');
  });

  it('after it loads, the core wins; a differing copy is newer and taken in; a lost copy is restored', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'collection.upsert', collection: 'settings', entries: { a: '1', b: '2' } });
    await settingsView.connect(link(handle));
    expect(settingsStorage.getItem('a')).toBe('1');
    expect(localStorage.getItem('a')).toBe('1');
    localStorage.setItem('b', 'seeded');
    expect(settingsStorage.getItem('b')).toBe('seeded');
    expect(settingsView.get('b')).toBe('seeded');
    settingsStorage.removeItem('a');
    expect(settingsStorage.getItem('a')).toBeNull();
    expect(localStorage.getItem('a')).toBeNull();
  });
});

