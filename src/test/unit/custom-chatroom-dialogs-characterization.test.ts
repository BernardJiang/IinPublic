/** @jest-environment jsdom */

import {
  showCreateCustomChatroomDialog,
  showRenameCustomChatroomDialog,
} from '../../web/ui/custom-chatroom-dialogs';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

function text(key: UiTranslationKey): string {
  return uiText('en', key);
}

function formatText(key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
    text(key),
  );
}

describe('custom-chatroom dialogs characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('validates and collects a trimmed business-room draft with bounded numeric capacity', async () => {
    const showWarning = jest.fn();
    const promise = showCreateCustomChatroomDialog({
      text: (key) => key === 'chatroomCreateTitle' ? '<script>New Room</script>' : text(key),
      showWarning,
    });

    expect(document.querySelector('script')).toBeNull();
    const businessGroup = document.querySelector<HTMLElement>('#custom-room-business-headline-group')!;
    const typeSelect = document.querySelector<HTMLSelectElement>('#custom-room-type')!;
    expect(businessGroup.style.display).toBe('none');
    typeSelect.value = 'business';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(businessGroup.style.display).toBe('block');

    const form = document.querySelector<HTMLFormElement>('#create-custom-chatroom-form')!;
    document.querySelector<HTMLInputElement>('#custom-room-name')!.value = ' x ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(showWarning).toHaveBeenCalledWith('Name must be at least 2 characters.');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    document.querySelector<HTMLInputElement>('#custom-room-name')!.value = '  Repair Club  ';
    document.querySelector<HTMLTextAreaElement>('#custom-room-description')!.value = '  Fix things together  ';
    document.querySelector<HTMLInputElement>('#custom-room-capacity')!.value = '42.9';
    document.querySelector<HTMLInputElement>('#custom-room-business-headline')!.value = '  Community repairs  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await expect(promise).resolves.toEqual({
      type: 'business',
      name: 'Repair Club',
      description: 'Fix things together',
      capacity: 42,
      businessInfo: { headline: 'Community repairs' },
    });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('omits empty optional custom-room fields and cancels from the backdrop', async () => {
    const showWarning = jest.fn();
    const submitPromise = showCreateCustomChatroomDialog({ text, showWarning });
    document.querySelector<HTMLInputElement>('#custom-room-name')!.value = ' Community ';
    document.querySelector<HTMLInputElement>('#custom-room-capacity')!.value = '0';
    document.querySelector<HTMLInputElement>('#custom-room-business-headline')!.value = 'Ignored';
    document.querySelector<HTMLFormElement>('#create-custom-chatroom-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await expect(submitPromise).resolves.toEqual({ type: 'custom', name: 'Community' });
    expect(showWarning).not.toHaveBeenCalled();

    const cancelPromise = showCreateCustomChatroomDialog({ text, showWarning });
    document.querySelector<HTMLElement>('.modal-overlay')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await expect(cancelPromise).resolves.toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('renders the current rename safely, validates, trims, and cleans up on success', async () => {
    const showWarning = jest.fn();
    const promise = showRenameCustomChatroomDialog({
      currentName: '<img src=x onerror=alert(1)>',
      text,
      formatText,
      showWarning,
    });

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.rename-custom-room-current')?.textContent).toBe(
      'Current: <img src=x onerror=alert(1)>',
    );
    const input = document.querySelector<HTMLInputElement>('#rename-custom-room-name')!;
    expect(input.value).toBe('<img src=x onerror=alert(1)>');
    const form = document.querySelector<HTMLFormElement>('#rename-custom-chatroom-form')!;
    input.value = ' x ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(showWarning).toHaveBeenCalledWith('Name must be at least 2 characters.');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    input.value = '  New name  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expect(promise).resolves.toBe('New name');
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
});
