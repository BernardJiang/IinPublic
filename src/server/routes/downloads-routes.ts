import express from 'express';
import fs from 'fs';
import path from 'path';

export interface DownloadManifest {
  version: string;
  mac: string | null;
  windows: string | null;
  linux: string | null;
  android: string | null;
  ios: string | null;
}

type DownloadPlatform = Exclude<keyof DownloadManifest, 'version'>;

const EXTENSIONS_BY_PLATFORM: Record<DownloadPlatform, string[]> = {
  mac: ['.dmg'],
  windows: ['.exe'],
  linux: ['.appimage', '.deb'],
  android: ['.apk'],
  ios: ['.ipa'],
};

const ENV_URL_BY_PLATFORM: Record<DownloadPlatform, string> = {
  mac: 'IINPUBLIC_DOWNLOAD_MAC_URL',
  windows: 'IINPUBLIC_DOWNLOAD_WINDOWS_URL',
  linux: 'IINPUBLIC_DOWNLOAD_LINUX_URL',
  android: 'IINPUBLIC_DOWNLOAD_ANDROID_URL',
  ios: 'IINPUBLIC_DOWNLOAD_IOS_URL',
};

/**
 * Only files containing the current release version are eligible. Old installers
 * may remain in this ignored directory, but the relay must never offer them as
 * the current app after package metadata has advanced.
 */
export function buildDownloadManifest(
  downloadsDir: string,
  env: NodeJS.ProcessEnv = process.env,
  expectedVersion = readRootVersion(),
): DownloadManifest {
  let files: string[] = [];
  try {
    files = fs.readdirSync(downloadsDir);
  } catch {
    // public/downloads/ does not exist on this deployment — manifest stays empty.
  }
  const manifest = {
    version: expectedVersion,
    mac: null,
    windows: null,
    linux: null,
    android: null,
    ios: null,
  } as DownloadManifest;
  const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionPattern = new RegExp(`(^|[^0-9])${escapedVersion}([^0-9]|$)`);
  const newestFirst = files.filter((file) => versionPattern.test(file)).sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }),
  );
  for (const platform of Object.keys(EXTENSIONS_BY_PLATFORM) as DownloadPlatform[]) {
    const configuredUrl = env[ENV_URL_BY_PLATFORM[platform]]?.trim();
    if (configuredUrl) {
      const resolvedUrl = configuredUrl.replaceAll('{version}', expectedVersion);
      manifest[platform] = resolvedUrl.startsWith('https://') ? resolvedUrl : null;
      continue;
    }
    const match = newestFirst.find((file) =>
      EXTENSIONS_BY_PLATFORM[platform].some((extension) =>
        file.toLowerCase().endsWith(extension),
      ),
    );
    manifest[platform] = match ? `/downloads/${encodeURIComponent(match)}` : null;
  }
  return manifest;
}

function readRootVersion(): string {
  const configuredVersion = process.env.IINPUBLIC_APP_VERSION?.trim();
  if (configuredVersion) return configuredVersion;
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Fail closed below: without a known version no local artifact is eligible.
  }
  return '__unknown_release_version__';
}

export function registerDownloadRoutes(app: express.Application, downloadsDir?: string): void {
  const resolvedDir = downloadsDir || path.resolve(process.cwd(), 'public', 'downloads');
  const expectedVersion = readRootVersion();
  app.get('/api/downloads', (_req, res) => {
    res.json(buildDownloadManifest(resolvedDir, process.env, expectedVersion));
  });
  app.get('/downloads/:filename', (req, res) => {
    const manifest = buildDownloadManifest(resolvedDir, {}, expectedVersion);
    const requestedUrl = `/downloads/${encodeURIComponent(req.params.filename)}`;
    const isCurrentArtifact = Object.entries(manifest).some(
      ([key, value]) => key !== 'version' && value === requestedUrl,
    );
    if (!isCurrentArtifact) {
      res.sendStatus(404);
      return;
    }
    res.sendFile(path.join(resolvedDir, req.params.filename));
  });
}
