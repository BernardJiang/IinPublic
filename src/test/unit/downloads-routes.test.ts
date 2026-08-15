import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { buildDownloadManifest, registerDownloadRoutes } from '../../server/routes/downloads-routes';

describe('app download manifest', () => {
  let downloadsDir: string;

  beforeEach(() => {
    downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-downloads-'));
  });

  afterEach(() => {
    delete process.env.IINPUBLIC_APP_VERSION;
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  });

  it('serves only installers matching the current release version', () => {
    for (const filename of [
      'IinPublic-1.0.6-arm64.dmg',
      'IinPublic-1.0.7-arm64.dmg',
      'IinPublic Setup 1.0.0.exe',
      'IinPublic Setup 1.0.7.exe',
      'IinPublic-1.0.7.AppImage',
      'IinPublic-1.0.7.apk',
    ]) {
      fs.writeFileSync(path.join(downloadsDir, filename), 'fixture');
    }

    expect(buildDownloadManifest(downloadsDir, {}, '1.0.7')).toEqual({
      version: '1.0.7',
      mac: '/downloads/IinPublic-1.0.7-arm64.dmg',
      windows: '/downloads/IinPublic%20Setup%201.0.7.exe',
      linux: '/downloads/IinPublic-1.0.7.AppImage',
      android: '/downloads/IinPublic-1.0.7.apk',
      ios: null,
    });
  });

  it('does not fall back to an installer from an older release', () => {
    fs.writeFileSync(path.join(downloadsDir, 'IinPublic-Setup-1.0.0.exe'), 'fixture');

    expect(buildDownloadManifest(downloadsDir, {}, '1.0.9')).toMatchObject({
      version: '1.0.9',
      windows: null,
    });
  });

  it('prefers hosted release URLs over local files', () => {
    expect(buildDownloadManifest(downloadsDir, {
      IINPUBLIC_DOWNLOAD_ANDROID_URL: 'https://downloads.example/{version}/IinPublic.apk',
    }, '1.0.9')).toMatchObject({
      android: 'https://downloads.example/1.0.9/IinPublic.apk',
    });
  });

  it('rejects hosted download URLs that are not HTTPS', () => {
    expect(buildDownloadManifest(downloadsDir, {
      IINPUBLIC_DOWNLOAD_WINDOWS_URL: 'http://downloads.example/IinPublic.exe',
    }, '1.0.9')).toMatchObject({ windows: null });
  });

  it('blocks stale installer URLs even when the file still exists', async () => {
    fs.writeFileSync(path.join(downloadsDir, 'IinPublic-1.0.8-windows.exe'), 'old');
    fs.writeFileSync(path.join(downloadsDir, 'IinPublic-1.0.9-windows.exe'), 'current');
    const app = express();
    process.env.IINPUBLIC_APP_VERSION = '1.0.9';
    registerDownloadRoutes(app, downloadsDir);

    await request(app).get('/downloads/IinPublic-1.0.8-windows.exe').expect(404);
    await request(app)
      .get('/downloads/IinPublic-1.0.9-windows.exe')
      .expect(200)
      .expect((response) => {
        expect(Buffer.from(response.body).toString()).toBe('current');
      });
  });
});
