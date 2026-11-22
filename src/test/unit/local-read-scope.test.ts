/** @jest-environment jsdom */
/**
 * C10 (2026-11-22): a Talks redraw read localStorage a few hundred times (the language per string,
 * an old-blob check per collection read). Within one draw each key is read once; a write clears it.
 */
import { forgetLocalReads, readLocal, withLocalReadScope } from '../../web/services/local-read-scope';
import { settingsStorage } from '../../web/services/core-storage';

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

it('reads each key once inside a scope and every time outside it', () => {
  localStorage.setItem('k', 'v');
  const getItem = jest.spyOn(Storage.prototype, 'getItem');
  withLocalReadScope(() => {
    expect(readLocal('k')).toBe('v');
    expect(readLocal('k')).toBe('v');
    expect(readLocal('missing')).toBeNull();
    expect(readLocal('missing')).toBeNull();
  });
  expect(getItem).toHaveBeenCalledTimes(2);
  readLocal('k');
  readLocal('k');
  expect(getItem).toHaveBeenCalledTimes(4);
});

it('a write in the scope is seen by the next read', () => {
  withLocalReadScope(() => {
    expect(readLocal('k')).toBeNull();
    localStorage.setItem('k', 'v');
    forgetLocalReads();
    expect(readLocal('k')).toBe('v');
    settingsStorage.setItem('iinpublic_ui_language', 'zh');
    expect(settingsStorage.getItem('iinpublic_ui_language')).toBe('zh');
  });
});
