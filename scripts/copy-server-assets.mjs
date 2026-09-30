import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = [
  {
    source: 'src/server/security/google-hardware-attestation-roots.pem',
    destination: 'dist/server/server/security/google-hardware-attestation-roots.pem',
  },
];

for (const asset of assets) {
  const source = resolve(projectRoot, asset.source);
  const destination = resolve(projectRoot, asset.destination);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`Copied ${assets.length} server runtime asset${assets.length === 1 ? '' : 's'}.`);
