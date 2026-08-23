import SEA from 'gun/sea';
import type { DeviceSyncOutboxState, DeviceSyncOutboxStore } from '../../shared/device-sync-outbox';
import { getSEA, type GunPair } from '../sea-gun';

function sea(): any {
  return getSEA() ?? SEA;
}

/** Single-record encrypted outbox; setItem gives browser-local atomic replacement. */
export class WebDeviceSyncOutboxStore implements DeviceSyncOutboxStore {
  readonly protection = 'device-local-encrypted-custody' as const;

  constructor(
    private readonly storage: Storage,
    private readonly sourcePair: GunPair,
    private readonly storageKey: string,
  ) {
    if (!sourcePair?.pub || !sourcePair?.priv || !sourcePair?.epub || !sourcePair?.epriv) throw new Error('device sync outbox requires a complete source pair');
    if (!storageKey) throw new Error('device sync outbox requires a storage key');
  }

  async load(): Promise<DeviceSyncOutboxState | null> {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return null;
    let wrapper: { version?: number; ciphertext?: string };
    try {
      wrapper = JSON.parse(raw) as { version?: number; ciphertext?: string };
    } catch {
      throw new Error('device sync outbox wrapper is malformed');
    }
    if (wrapper.version !== 1 || !wrapper.ciphertext) throw new Error('unsupported device sync outbox wrapper');
    const decrypted = await sea().decrypt(wrapper.ciphertext, this.sourcePair);
    if (!decrypted) throw new Error('device sync outbox custody decryption failed');
    try {
      return (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as DeviceSyncOutboxState;
    } catch {
      throw new Error('device sync outbox plaintext is malformed');
    }
  }

  async save(state: DeviceSyncOutboxState): Promise<void> {
    const ciphertext = await sea().encrypt(JSON.stringify(state), this.sourcePair);
    if (typeof ciphertext !== 'string' || !ciphertext) throw new Error('device sync outbox custody encryption failed');
    this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, ciphertext }));
  }
}
