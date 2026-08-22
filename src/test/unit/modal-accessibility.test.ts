/** @jest-environment jsdom */

import { activateModalAccessibility } from '../../web/ui/modal-accessibility';

describe('modal accessibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Open</button>';
  });

  it('moves focus in, traps Tab, closes on Escape, and restores the opener', () => {
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div role="dialog">
        <button id="first">First</button>
        <button id="last">Last</button>
      </div>`;
    document.body.appendChild(overlay);
    let cleanup = () => {};
    const close = jest.fn(() => {
      cleanup();
      overlay.remove();
    });
    cleanup = activateModalAccessibility(overlay, { onEscape: close, restoreFocusTo: opener });

    const first = document.getElementById('first') as HTMLButtonElement;
    const last = document.getElementById('last') as HTMLButtonElement;
    expect(document.activeElement).toBe(first);

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});
