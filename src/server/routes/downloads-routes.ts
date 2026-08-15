import express from 'express';
import fs from 'fs';
import path from 'path';

export interface DownloadManifest {
  mac: string | null;
  windows: string | null;
  linux: string | null;
  android: string | null;
  ios: string | null;
}

const EXTENSIONS_BY_PLATFORM: Record<keyof DownloadManifest, string[]> = {
  mac: ['.dmg'],
  windows: ['.exe'],
  linux: ['.appimage', '.deb'],
  android: ['.apk'],
  ios: ['.ipa'],
};

const ENV_URL_BY_PLATFORM: Record<keyof DownloadManifest, string> = {
  mac: 'IINPUBLIC_DOWNLOAD_MAC_URL',
  windows: 'IINPUBLIC_DOWNLOAD_WINDOWS_URL',
  linux: 'IINPUBLIC_DOWNLOAD_LINUX_URL',
  android: 'IINPUBLIC_DOWNLOAD_ANDROID_URL',
  ios: 'IINPUBLIC_DOWNLOAD_IOS_URL',
};

/**
 * Local-network app-download story: the relay serves whatever installers happen
 * to be staged in public/downloads/ (never committed — see .gitignore) so a
 * plain browser tab pointed at the hub can offer a same-network download instead
 * of a dead link to a public app-store listing we don't have yet.
 */
export function buildDownloadManifest(
  downloadsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): DownloadManifest {
  let files: string[] = [];
  try {
    files = fs.readdirSync(downloadsDir);
  } catch {
    // public/downloads/ does not exist on this deployment — manifest stays empty.
  }
  const manifest = {
    mac: null,
    windows: null,
    linux: null,
    android: null,
    ios: null,
  } as DownloadManifest;
  const newestFirst = files.sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }),
  );
  for (const platform of Object.keys(EXTENSIONS_BY_PLATFORM) as Array<keyof DownloadManifest>) {
    const configuredUrl = env[ENV_URL_BY_PLATFORM[platform]]?.trim();
    if (configuredUrl) {
      manifest[platform] = configuredUrl;
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

export function registerDownloadRoutes(app: express.Application, downloadsDir?: string): void {
  const resolvedDir = downloadsDir || path.resolve(process.cwd(), 'public', 'downloads');
  app.get('/api/downloads', (_req, res) => {
    res.json(buildDownloadManifest(resolvedDir));
  });
}
