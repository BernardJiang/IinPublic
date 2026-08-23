/** @jest-environment jsdom */
import { showDeviceSyncConflictDialog } from '../../web/ui/device-sync-conflict-dialog';
import type { DeviceSyncImportConflict } from '../../shared/device-sync-importer';

function conflict(id: string): DeviceSyncImportConflict {
  const base = {
    category: 'contacts' as const,
    recordId: id,
    originPub: 'origin',
    authorPub: 'author',
    createdAt: '2026-08-22T20:00:00.000Z',
    updatedAt: '2026-08-22T20:01:00.000Z',
    version: 2,
    tombstone: false,
  };
  return {
    category: 'contacts',
    recordId: id,
    reason: 'ambiguous-concurrent-edit',
    local: { ...base, payload: { secret: 'local secret' } },
    incoming: { ...base, payload: { secret: 'incoming secret' } },
  };
}

describe('device sync conflict dialog', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="opener">Open</button>'; });
  const text = (_key: string, fallback = '') => fallback;

  it('shows metadata without exposing private payloads and requires every choice', async () => {
    (document.getElementById('opener') as HTMLButtonElement).focus();
    const result = showDeviceSyncConflictDialog({ conflicts: [conflict('one'), conflict('two')], text });
    const overlay = document.getElementById('device-sync-conflict-overlay')!;
    expect(overlay.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(overlay.textContent).not.toContain('local secret');
    expect(overlay.textContent).not.toContain('incoming secret');
    const apply = overlay.querySelector('#device-sync-conflict-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    (overlay.querySelector('input[name="device-sync-conflict-0"][value="keep-local"]') as HTMLInputElement).click();
    expect(apply.disabled).toBe(true);
    (overlay.querySelector('input[name="device-sync-conflict-1"][value="use-incoming"]') as HTMLInputElement).click();
    expect(apply.disabled).toBe(false);
    apply.click();
    await expect(result).resolves.toEqual([
      { category: 'contacts', recordId: 'one', resolution: 'keep-local' },
      { category: 'contacts', recordId: 'two', resolution: 'use-incoming' },
    ]);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('cancels with Escape and restores focus', async () => {
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    const result = showDeviceSyncConflictDialog({ conflicts: [conflict('one')], text });
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(result).resolves.toBeNull();
    expect(document.getElementById('device-sync-conflict-overlay')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
