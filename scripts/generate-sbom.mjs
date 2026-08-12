import { readFileSync, writeFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const root = lock.packages?.[''] ?? {};
const direct = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);
// Old packages sometimes omit SPDX metadata from package.json/package-lock. These
// values were verified against the license file shipped in the locked npm tarball.
const auditedLicenseOverrides = new Map([
  ['exit', 'MIT'],
  ['spawn-command', 'MIT'],
  ['xmlhttprequest-ssl', 'MIT'],
]);
const packages = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.startsWith('node_modules/'))
  .map(([path, metadata]) => ({
    name: path.replace(/^node_modules\//, ''),
    version: metadata.version ?? 'unknown',
    license: metadata.license ?? auditedLicenseOverrides.get(path.replace(/^node_modules\//, '')) ?? 'NOASSERTION',
    direct: direct.has(path.replace(/^node_modules\//, '')),
    resolved: metadata.resolved ?? null,
    integrity: metadata.integrity ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const artifact = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:iinpublic-${lock.lockfileVersion}-${packages.length}`,
  version: 1,
  metadata: { component: { type: 'application', name: root.name ?? 'iinpublic', version: root.version ?? 'unknown', licenses: [{ license: { id: root.license ?? 'NOASSERTION' } }] } },
  components: packages.map((entry) => ({
    type: 'library', name: entry.name, version: entry.version,
    scope: entry.direct ? 'required' : 'optional',
    licenses: [{ license: { id: entry.license } }],
    hashes: entry.integrity ? [{ alg: 'SRI', content: entry.integrity }] : [],
    externalReferences: entry.resolved ? [{ type: 'distribution', url: entry.resolved }] : [],
    properties: [{ name: 'iinpublic:directDependency', value: String(entry.direct) }],
  })),
};

writeFileSync(new URL('../docs/dependency-sbom.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
const unknown = packages.filter((entry) => entry.license === 'NOASSERTION');
if (unknown.length) {
  console.error(`SBOM generated, but ${unknown.length} dependencies have no asserted license: ${unknown.map((entry) => entry.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Wrote docs/dependency-sbom.json with ${packages.length} packages and asserted licenses.`);
}
