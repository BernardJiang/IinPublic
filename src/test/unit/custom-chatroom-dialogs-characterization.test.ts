/** @jest-environment jsdom */

import { showCreateCustomChatroomDialog } from '../../web/ui/custom-chatroom-dialogs';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

function text(key: UiTranslationKey): string {
  return uiText('en', key);
}

describe('custom-chatroom dialogs characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('validates and collects a trimmed business-room draft (capacity is unified, not asked for)', async () => {
    const showWarning = jest.fn();
    const promise = showCreateCustomChatroomDialog({
      text: (key) => key === 'chatroomCreateTitle' ? '<script>New Room</script>' : text(key),
      showWarning,
    });

    expect(document.querySelector('script')).toBeNull();
    // Every room shares one unified capacity, so there is no per-room capacity field any more.
    expect(document.querySelector('#custom-room-capacity')).toBeNull();
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
    document.querySelector<HTMLInputElement>('#custom-room-business-headline')!.value = '  Community repairs  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await expect(promise).resolves.toEqual({
      type: 'business',
      name: 'Repair Club',
      description: 'Fix things together',
      businessInfo: { headline: 'Community repairs' },
    });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('omits empty optional custom-room fields and cancels from the backdrop', async () => {
    const showWarning = jest.fn();
    const submitPromise = showCreateCustomChatroomDialog({ text, showWarning });
    document.querySelector<HTMLInputElement>('#custom-room-name')!.value = ' Community ';
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
});
