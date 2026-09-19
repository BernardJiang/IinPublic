import * as fs from 'fs';
import * as path from 'path';

export type ConfiguredAndroidDevice = {
  name: string;
  serial: string;
  model?: string;
};

type DeviceMatrixConfig = {
  android?: ConfiguredAndroidDevice[];
};

const CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', 'matrix', 'devices.json');

export function configuredAndroidDevices(): ConfiguredAndroidDevice[] {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as DeviceMatrixConfig;
  const devices = parsed.android ?? [];
  const names = new Set<string>();
  const serials = new Set<string>();

  for (const device of devices) {
    if (!device.name?.trim() || !device.serial?.trim()) {
      throw new Error(`${CONFIG_PATH}: every Android device needs a non-empty name and serial`);
    }
    if (names.has(device.name)) throw new Error(`${CONFIG_PATH}: duplicate device name ${device.name}`);
    if (serials.has(device.serial)) throw new Error(`${CONFIG_PATH}: duplicate device serial ${device.serial}`);
    names.add(device.name);
    serials.add(device.serial);
  }

  return devices;
}

/**
 * The explicit environment list remains useful for ad-hoc hardware, but configured
 * devices provide stable logical names for the normal Mac-mini matrix.
 */
export function resolveAndroidMatrixDevices(
  serialOverride = '',
  logicalNameOverride = '',
): ConfiguredAndroidDevice[] {
  const configured = configuredAndroidDevices();
  const overrideNames = logicalNameOverride.split(',').map((name) => name.trim()).filter(Boolean);
  if (overrideNames.length > 0 && serialOverride.trim()) {
    throw new Error('Select Android devices by logical name or serial, not both');
  }
  if (overrideNames.length > 0) {
    const byName = new Map(configured.map((device) => [device.name, device]));
    return overrideNames.map((name) => {
      const device = byName.get(name);
      if (!device) {
        throw new Error(`Unknown Android logical name ${name}; choose ${configured.map((item) => item.name).join(', ')}`);
      }
      return device;
    });
  }
  const bySerial = new Map(configured.map((device) => [device.serial, device]));
  const overrideSerials = serialOverride.split(',').map((serial) => serial.trim()).filter(Boolean);
  if (overrideSerials.length === 0) return configured;
  return overrideSerials.map((serial, index) =>
    bySerial.get(serial) ?? { name: `android-${index + 1}`, serial },
  );
}
