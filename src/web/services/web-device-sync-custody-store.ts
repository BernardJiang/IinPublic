import SEA from 'gun/sea';
import { sha256Hex } from '../../shared/merkle-checkpoint';
import type {
  DeviceSyncAcknowledgement,
  DeviceSyncCategory,
  DeviceSyncRecord,
} from '../../shared/device-sync-contract';
import type {
  DeviceSyncCustodyStore,
  DeviceSyncImportProgress,
} from '../../shared/device-sync-importer';
import { getSEA, type GunPair } from '../sea-gun';

const STORE_VERSION = 1;

type StoredCiphertext = {
  version: typeof STORE_VERSION;
  ciphertext: string;
};

function sea(): any {
  return getSEA() ?? SEA;
}

/**
 * Browser implementation of the WP5 import boundary. Every value, including
 * progress and acknowledgements, is re-encrypted with the receiving pair before
 * it is written. Storage keys use hashes so record IDs and peer pubs are not
 * exposed in localStorage key names.
 */
export class WebDeviceSyncCustodyStore implements DeviceSyncCustodyStore {
  readonly protection = 'receiving-device-local-custody' as const;

  constructor(
    private readonly storage: Storage,
    private readonly recipientPair: GunPair,
    private readonly namespace = 'iinpublic_device_sync_v1',
  ) {
    if (!recipientPair?.pub || !recipientPair?.priv || !recipientPair?.epub || !recipientPair?.epriv) {
      throw new Error('device sync custody requires a complete receiving pair');
    }
  }

  async readRecord(category: DeviceSyncCategory, recordId: string): Promise<DeviceSyncRecord | null> {
    return this.readEncrypted<DeviceSyncRecord>(await this.key('record', `${category}\u0000${recordId}`));
  }

  async writeRecord(record: DeviceSyncRecord): Promise<void> {
    await this.writeEncrypted(await this.key('record', `${record.category}\u0000${record.recordId}`), record);
  }

  async readProgress(checkpointId: string): Promise<DeviceSyncImportProgress | null> {
    return this.readEncrypted<DeviceSyncImportProgress>(await this.key('progress', checkpointId));
  }

  async writeProgress(progress: DeviceSyncImportProgress): Promise<void> {
    await this.writeEncrypted(await this.key('progress', progress.checkpointId), progress);
  }

  async readAcknowledgement(checkpointId: string): Promise<DeviceSyncAcknowledgement | null> {
    return this.readEncrypted<DeviceSyncAcknowledgement>(await this.key('ack', checkpointId));
  }

  async writeAcknowledgement(acknowledgement: DeviceSyncAcknowledgement): Promise<void> {
    await this.writeEncrypted(await this.key('ack', acknowledgement.checkpointId), acknowledgement);
  }

  async readHead(sourceDevicePub: string): Promise<string | null> {
    const value = await this.readEncrypted<{ checkpointId: string }>(await this.key('head', sourceDevicePub));
    return value?.checkpointId ?? null;
  }

  async writeHead(sourceDevicePub: string, checkpointId: string): Promise<void> {
    await this.writeEncrypted(await this.key('head', sourceDevicePub), { checkpointId });
  }

  private async key(kind: 'record' | 'progress' | 'ack' | 'head', identifier: string): Promise<string> {
    return `${this.namespace}:${kind}:${await sha256Hex(identifier)}`;
  }

  private async writeEncrypted(key: string, value: unknown): Promise<void> {
    const ciphertext = await sea().encrypt(JSON.stringify(value), this.recipientPair);
    if (typeof ciphertext !== 'string' || !ciphertext) throw new Error('receiving-device custody encryption failed');
    const wrapped: StoredCiphertext = { version: STORE_VERSION, ciphertext };
    this.storage.setItem(key, JSON.stringify(wrapped));
  }

  private async readEncrypted<T>(key: string): Promise<T | null> {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    let wrapped: StoredCiphertext;
    try {
      wrapped = JSON.parse(raw) as StoredCiphertext;
    } catch {
      throw new Error('receiving-device custody record is malformed');
    }
    if (wrapped.version !== STORE_VERSION || !wrapped.ciphertext) throw new Error('unsupported receiving-device custody record');
    const decrypted = await sea().decrypt(wrapped.ciphertext, this.recipientPair);
    if (!decrypted) throw new Error('receiving-device custody decryption failed');
    try {
      return (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as T;
    } catch {
      throw new Error('receiving-device custody plaintext is malformed');
    }
  }
}
