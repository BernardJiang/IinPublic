/** @jest-environment jsdom */

import { showLocationRoomSuggestion } from '../../web/ui/location-room-suggestion';

const deps = {
  t: (key: string) => key,
  tf: (key: string, values: Record<string, string | number>) => `${key}(${JSON.stringify(values)})`,
};

beforeEach(() => {
  document.body.innerHTML = '<div id="chatroom-list-container"></div>';
});

describe('showLocationRoomSuggestion', () => {
  it('does nothing when the chatroom-list-container host is absent', () => {
    document.body.innerHTML = '';
    expect(() => showLocationRoomSuggestion('North America', jest.fn(), deps)).not.toThrow();
  });

  it('renders the suggested room name into the banner', () => {
    showLocationRoomSuggestion('North America', jest.fn(), deps);
    expect(document.getElementById('location-room-suggestion')!.textContent).toContain('locationSuggestedRoom');
    expect(document.getElementById('location-room-suggestion')!.innerHTML).toContain('North America');
  });

  it('replaces an existing banner rather than stacking a second one', () => {
    showLocationRoomSuggestion('Room A', jest.fn(), deps);
    showLocationRoomSuggestion('Room B', jest.fn(), deps);
    expect(document.querySelectorAll('#location-room-suggestion')).toHaveLength(1);
    expect(document.getElementById('location-room-suggestion')!.innerHTML).toContain('Room B');
  });

  it('clicking join removes the banner and calls onJoin', () => {
    const onJoin = jest.fn();
    showLocationRoomSuggestion('North America', onJoin, deps);
    document.querySelector<HTMLButtonElement>('[data-action="join"]')!.click();
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(document.getElementById('location-room-suggestion')).toBeNull();
  });

  it('clicking dismiss removes the banner without calling onJoin', () => {
    const onJoin = jest.fn();
    showLocationRoomSuggestion('North America', onJoin, deps);
    document.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!.click();
    expect(onJoin).not.toHaveBeenCalled();
    expect(document.getElementById('location-room-suggestion')).toBeNull();
  });
});
