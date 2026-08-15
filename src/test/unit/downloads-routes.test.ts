import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDownloadManifest } from '../../server/routes/downloads-routes';

describe('app download manifest', () => {
  let downloadsDir: string;

  beforeEach(() => {
    downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-downloads-'));
  });

  afterEach(() => {
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  });

  it('selects the newest staged installer for every supported platform', () => {
    for (const filename of [
      'IinPublic-1.0.6-arm64.dmg',
      'IinPublic-1.0.7-arm64.dmg',
      'IinPublic Setup 1.0.3.exe',
      'IinPublic-1.0.3.AppImage',
      'IinPublic-1.0.7.apk',
    ]) {
      fs.writeFileSync(path.join(downloadsDir, filename), 'fixture');
    }

    expect(buildDownloadManifest(downloadsDir, {})).toEqual({
      mac: '/downloads/IinPublic-1.0.7-arm64.dmg',
      windows: '/downloads/IinPublic%20Setup%201.0.3.exe',
      linux: '/downloads/IinPublic-1.0.3.AppImage',
      android: '/downloads/IinPublic-1.0.7.apk',
      ios: null,
    });
  });

  it('prefers hosted release URLs over local files', () => {
    expect(buildDownloadManifest(downloadsDir, {
      IINPUBLIC_DOWNLOAD_ANDROID_URL: 'https://downloads.example/IinPublic.apk',
    })).toMatchObject({
      android: 'https://downloads.example/IinPublic.apk',
    });
  });
});
