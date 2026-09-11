import { showEraseDeviceDialog } from './erase-device-dialog';
import type { LinkedDeviceRow } from './linked-devices-dialog';
import { eraseDevice } from '../services/device-wipe';
import type { HandoffCategory } from '../../shared/device-handoff';

export type EraseDeviceFlowDeps = {
  t: (key: string) => string;
  identityLinkUnlinker?: ((pub: string) => Promise<'removed' | 'revocation-pending'>) | undefined;
  deviceHandoffSync?: ((toPub: string, progress: (category: HandoffCategory) => void) => Promise<void>) | undefined;
};

export function openEraseDeviceDialog(deps: EraseDeviceFlowDeps): void {
  let linked: LinkedDeviceRow[] = [];
  try {
    const arr = JSON.parse(localStorage.getItem('iinpublic_linked_devices') || '[]');
    // Only graph-verified active links are eligible sync/revocation targets.
    // Historical Removed/Invalid rows must not imply a receiver is available.
    linked = Array.isArray(arr)
      ? arr.filter((row: LinkedDeviceRow) => row.state === 'linked')
      : [];
  } catch {
    linked = [];
  }
  showEraseDeviceDialog({
    text: (key: string, fallback?: string) => {
      const value = deps.t(key);
      return value && value !== key ? value : (fallback ?? key);
    },
    hasLinkedDevice: linked.length > 0,
    ...(linked[0]?.stageName ? { linkedDeviceName: linked[0].stageName } : {}),
    onErase: async () => {
      await eraseDevice({
        revokeLinks: async () => {
          if (deps.identityLinkUnlinker) {
            for (const r of linked) await deps.identityLinkUnlinker(r.pub).catch(() => {});
          }
        },
      });
    },
    ...(deps.deviceHandoffSync && linked[0]?.pub
      ? { onSyncFirst: (progress: (category: HandoffCategory) => void) =>
          deps.deviceHandoffSync!(linked[0].pub, progress) }
      : {}),
  });
}
