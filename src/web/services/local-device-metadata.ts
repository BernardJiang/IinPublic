export type LocalDevicePlatform = 'android' | 'ios' | 'desktop' | 'browser';

export interface LocalDeviceMetadata {
  schemaVersion: 1;
  name: string;
  platform: LocalDevicePlatform;
  createdAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const LOCAL_DEVICE_METADATA_KEY = 'iinpublic_local_device_metadata_v1';

const MAX_DEVICE_NAME_LENGTH = 64;

export function normalizeDeviceName(value: string): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH);
}

export function detectLocalDevicePlatform(explicitPlatform = '', userAgent = ''): LocalDevicePlatform {
  const explicit = explicitPlatform.toLowerCase();
  const agent = userAgent.toLowerCase();
  if (/android/.test(explicit) || /android/.test(agent)) return 'android';
  if (/(iphone|ipad|ios)/.test(explicit) || /(iphone|ipad)/.test(agent)) return 'ios';
  if (/(electron|desktop|macos|windows|linux)/.test(explicit) || /electron/.test(agent)) return 'desktop';
  return 'browser';
}

export function readLocalDeviceMetadata(storage: StorageLike): LocalDeviceMetadata | null {
  try {
    const raw = storage.getItem(LOCAL_DEVICE_METADATA_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LocalDeviceMetadata>;
    const name = normalizeDeviceName(value.name || '');
    const platform = value.platform;
    if (
      value.schemaVersion !== 1 ||
      !name ||
      !['android', 'ios', 'desktop', 'browser'].includes(String(platform)) ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt)
    ) {
      return null;
    }
    return { schemaVersion: 1, name, platform: platform as LocalDevicePlatform, createdAt: value.createdAt };
  } catch {
    return null;
  }
}

export function getOrCreateLocalDeviceMetadata(
  storage: StorageLike,
  defaults: { name: string; platform: LocalDevicePlatform; createdAt: number },
): LocalDeviceMetadata {
  const existing = readLocalDeviceMetadata(storage);
  if (existing) return existing;
  const metadata: LocalDeviceMetadata = {
    schemaVersion: 1,
    name: normalizeDeviceName(defaults.name) || 'This device',
    platform: defaults.platform,
    createdAt: Number.isFinite(defaults.createdAt) ? defaults.createdAt : Date.now(),
  };
  storage.setItem(LOCAL_DEVICE_METADATA_KEY, JSON.stringify(metadata));
  return metadata;
}

export function renameLocalDevice(storage: StorageLike, metadata: LocalDeviceMetadata, name: string): LocalDeviceMetadata {
  const normalized = normalizeDeviceName(name);
  if (!normalized) throw new Error('Device name is required');
  const updated = { ...metadata, name: normalized };
  storage.setItem(LOCAL_DEVICE_METADATA_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Compact comparison fingerprint sampled across the full SEA public key. SEA keys
 * are uniformly random, so sixteen base64url characters retain roughly 96 bits of
 * comparison entropy without displaying the full identity ID.
 */
export function formatIdentityFingerprint(publicKey: string): string {
  const normalized = String(publicKey || '').trim();
  if (!normalized) return '';
  const characterCount = Math.min(16, normalized.length);
  const sampled = Array.from({ length: characterCount }, (_, index) => {
    const sourceIndex = characterCount === 1
      ? 0
      : Math.round((index * (normalized.length - 1)) / (characterCount - 1));
    return normalized[sourceIndex];
  }).join('');
  return sampled.match(/.{1,4}/g)?.join(' ') || sampled;
}
