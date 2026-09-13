/** @jest-environment jsdom */

import { showEditStageNameDialog } from '../../web/ui/edit-stage-name-dialog';

function openDialog(overrides: Record<string, unknown> = {}) {
  return showEditStageNameDialog({
    user: { id: 'self', stageName: 'Alice <script>bad()</script>' },
    text: (key) => String(key),
    formatText: (_key, values) => `Current: ${String(values.name)}`,
    onStageNameChange: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe('edit StageName dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('renders current values safely and cancellation resolves and removes the modal', async () => {
    const promise = openDialog();

    expect(document.querySelector('.modal-header script')).toBeNull();
    expect((document.getElementById('new-stage-name') as HTMLInputElement).value).toBe(
      'Alice <script>bad()</script>',
    );
    document.getElementById('cancel-edit-btn')?.click();

    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('trims a valid name, awaits the update, and closes', async () => {
    const onStageNameChange = jest.fn().mockResolvedValue(undefined);
    const promise = openDialog({ onStageNameChange });
    const input = document.getElementById('new-stage-name') as HTMLInputElement;
    input.value = '  New Alice  ';

    (document.getElementById('edit-stagename-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await expect(promise).resolves.toBeUndefined();
    expect(onStageNameChange).toHaveBeenCalledWith('self', 'New Alice');
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('keeps the dialog open and alerts for a too-short name', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onStageNameChange = jest.fn();
    const promise = openDialog({ onStageNameChange });
    (document.getElementById('new-stage-name') as HTMLInputElement).value = ' x ';

    (document.getElementById('edit-stagename-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();

    expect(alertSpy).toHaveBeenCalledWith('stageDialogTooShort');
    expect(onStageNameChange).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    document.getElementById('cancel-edit-btn')?.click();
    await promise;
  });

  it('rejects with the update error and preserves the dialog for correction', async () => {
    const error = new Error('update failed');
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const promise = openDialog({ onStageNameChange: jest.fn().mockRejectedValue(error) });
    (document.getElementById('new-stage-name') as HTMLInputElement).value = 'Valid Name';

    (document.getElementById('edit-stagename-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await expect(promise).rejects.toBe(error);
    expect(alertSpy).toHaveBeenCalledWith('stageDialogUpdateFailed');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
  });
});
