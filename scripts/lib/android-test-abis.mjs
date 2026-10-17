// Build test APKs for only the ABIs of the phones under test (android/app/build.gradle reads
// IINPUBLIC_ANDROID_ABIS). The full three-ABI debug APK is 204 MB, 150 MB of it libnode.so, and
// these phones share one USB hub: ~2.5 min per install, and parallel installs time out. A one-ABI
// APK is ~55 MB. Release builds refuse the variable.

import { execFileSync } from 'node:child_process';

/** Set IINPUBLIC_ANDROID_ABIS from the phones' primary ABIs unless it is already set. */
export function useTestAbisFor(serials) {
  if (process.env.IINPUBLIC_ANDROID_ABIS !== undefined) return process.env.IINPUBLIC_ANDROID_ABIS;
  const abis = new Set();
  for (const serial of serials) {
    try {
      const abi = execFileSync('adb', ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'], { encoding: 'utf8', timeout: 10_000 }).trim();
      if (!abi) return '';
      abis.add(abi);
    } catch {
      return '';
    }
  }
  process.env.IINPUBLIC_ANDROID_ABIS = [...abis].join(',');
  console.log(`[android-abis] test APKs are built for ${process.env.IINPUBLIC_ANDROID_ABIS} only (IINPUBLIC_ANDROID_ABIS)`);
  return process.env.IINPUBLIC_ANDROID_ABIS;
}
