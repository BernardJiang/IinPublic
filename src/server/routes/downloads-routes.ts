import express from 'express';
import fs from 'fs';
import path from 'path';

export interface DownloadManifest {
  mac: string | null;
  windows: string | null;
  android: string | null;
}

const EXTENSION_BY_PLATFORM: Record<keyof DownloadManifest, string> = {
  mac: '.dmg',
  windows: '.exe',
  android: '.apk',
};

/**
 * Local-network app-download story: the relay serves whatever installers happen
 * to be staged in public/downloads/ (never committed — see .gitignore) so a
 * plain browser tab pointed at the hub can offer a same-network download instead
 * of a dead link to a public app-store listing we don't have yet.
 */
export function buildDownloadManifest(downloadsDir: string): DownloadManifest {
  let files: string[] = [];
  try {
    files = fs.readdirSync(downloadsDir);
  } catch {
    // public/downloads/ does not exist on this deployment — manifest stays empty.
  }
  const manifest = { mac: null, windows: null, android: null } as DownloadManifest;
  for (const platform of Object.keys(EXTENSION_BY_PLATFORM) as Array<keyof DownloadManifest>) {
    const match = files.find((f) => f.toLowerCase().endsWith(EXTENSION_BY_PLATFORM[platform]));
    manifest[platform] = match ? `/downloads/${match}` : null;
  }
  return manifest;
}

export function registerDownloadRoutes(app: express.Application, downloadsDir?: string): void {
  const resolvedDir = downloadsDir || path.resolve(process.cwd(), 'public', 'downloads');
  app.get('/api/downloads', (_req, res) => {
    res.json(buildDownloadManifest(resolvedDir));
  });
}
