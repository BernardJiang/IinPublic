/** @jest-environment jsdom */

import {
  getHasSeenActionableGuide,
  setHasSeenActionableGuide,
} from '../../web/ui/ui-settings-storage';

describe('actionable guide seen gate', () => {
  beforeEach(() => localStorage.clear());

  it('uses its versioned flag and accepts the legacy walkthrough flag for upgrades', () => {
    expect(getHasSeenActionableGuide()).toBe(false);
    setHasSeenActionableGuide(true);
    expect(getHasSeenActionableGuide()).toBe(true);
    localStorage.clear();
    localStorage.setItem('iinpublic_walkthrough_seen', 'true');
    expect(getHasSeenActionableGuide()).toBe(true);
  });
});
