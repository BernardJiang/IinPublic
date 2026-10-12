/** @jest-environment jsdom */

import { cohortStatusLine } from '../../web/ui/cohort-traversal-controls';
import { createLocalCohortTraversalViewModel } from '../../web/ui/cohort-traversal-view-model';
import { syncReturnHomeButton } from '../../web/ui/return-home-button';
import { uiText, type UiLanguage } from '../../web/ui/ui-translations';

const line = (model: ReturnType<typeof createLocalCohortTraversalViewModel>, language: UiLanguage = 'en') =>
  cohortStatusLine(model.getSnapshot(), (key) => uiText(language, key));

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Nearby group switching without extra buttons', () => {
  it('says nothing when this is the only group in the area', () => {
    expect(line(createLocalCohortTraversalViewModel({ groupCount: 1 }))).toBe('');
  });

  it('says nothing extra when other groups share the area (they are rows in the room list)', () => {
    expect(line(createLocalCohortTraversalViewModel({ groupCount: 4 }))).toBe('');
  });

  it('points at 🏠 while visiting another group, and reports a pending move', async () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4 });
    const move = model.meetAnotherGroup();
    expect(line(model)).toBe('Moving to another group… Your location is unchanged.');
    await move;
    await settle();
    expect(line(model)).toBe('You are visiting another group in the same area. Tap 🏠 to return to your own group.');
  });

  it.each([
    ['full', 'That group is full. You stayed in your current group; try another.'],
    ['error', 'Could not switch groups. You remain in your current group; try again.'],
  ] as const)('keeps the current group after a %s outcome', async (outcome, message) => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4 });
    model.setNextOutcome(outcome);
    await model.meetAnotherGroup();
    await settle();
    expect(line(model)).toBe(message);
    expect(model.getSnapshot().isDefaultGroup).toBe(true);
  });

  it('explains offline switching and translates without protocol identifiers', () => {
    expect(line(createLocalCohortTraversalViewModel({ groupCount: 4, online: false })))
      .toBe('Connect to switch groups. You remain in your current group.');
    const zh = line(createLocalCohortTraversalViewModel({ groupCount: 7, isDefaultGroup: false }), 'zh');
    expect(zh).toContain('🏠');
    expect(zh).not.toMatch(/_part_\d+|nearby_v\d+|identity/i);
  });

  it('enables 🏠 while visiting another group even when the room is home', () => {
    document.body.innerHTML = '<button id="return-home-btn"></button>';
    const button = document.getElementById('return-home-btn') as HTMLButtonElement;
    const base = { getHomeChatroomId: () => 'nearby_home', currentChatroom: 'nearby_home', resolveChatroomTitle: () => 'Nearby' };
    syncReturnHomeButton(base);
    expect(button.disabled).toBe(true);
    syncReturnHomeButton({ ...base, awayFromDefaultGroup: true });
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('Return to your own group');
  });
});
