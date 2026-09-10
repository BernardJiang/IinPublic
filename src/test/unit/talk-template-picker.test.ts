/** @jest-environment jsdom */

import { showTalkTemplatePicker } from '../../web/ui/talk-template-picker';
import { TALK_TEMPLATES } from '../../web/ui/talk-templates';

const t = (key: string): string => key;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showTalkTemplatePicker', () => {
  it('renders one row per built-in template plus a "start from scratch" row', () => {
    const openEditor = jest.fn();
    showTalkTemplatePicker({ t, openEditor });
    const rows = document.querySelectorAll('.talk-template-row');
    expect(rows.length).toBe(TALK_TEMPLATES.length + 1);
    expect(document.querySelector('[data-testid="talk-template-scratch"]')).not.toBeNull();
    for (const template of TALK_TEMPLATES) {
      expect(document.querySelector(`[data-testid="talk-template-${template.id}"]`)).not.toBeNull();
    }
  });

  it('opens the editor built from the chosen template and closes the modal', () => {
    const openEditor = jest.fn();
    showTalkTemplatePicker({ t, openEditor });
    const first = TALK_TEMPLATES[0];
    document
      .querySelector(`[data-testid="talk-template-${first.id}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(openEditor).toHaveBeenCalledWith(first.build());
    expect(document.getElementById('talk-template-picker-modal')).toBeNull();
  });

  it('opens the editor with no argument when "start from scratch" is chosen', () => {
    const openEditor = jest.fn();
    showTalkTemplatePicker({ t, openEditor });
    document
      .querySelector('[data-testid="talk-template-scratch"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openEditor).toHaveBeenCalledWith(undefined);
  });

  it('closes without opening the editor via the close button', () => {
    const openEditor = jest.fn();
    showTalkTemplatePicker({ t, openEditor });
    document.getElementById('close-talk-template-picker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('talk-template-picker-modal')).toBeNull();
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a click inside the modal content', () => {
    const openEditor = jest.fn();
    showTalkTemplatePicker({ t, openEditor });
    const modal = document.getElementById('talk-template-picker-modal')!;
    modal.querySelector('.modal-content')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('talk-template-picker-modal')).not.toBeNull();

    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('talk-template-picker-modal')).toBeNull();
  });

  it('replaces a stale modal from a previous call', () => {
    showTalkTemplatePicker({ t, openEditor: jest.fn() });
    showTalkTemplatePicker({ t, openEditor: jest.fn() });
    expect(document.querySelectorAll('#talk-template-picker-modal').length).toBe(1);
  });
});
