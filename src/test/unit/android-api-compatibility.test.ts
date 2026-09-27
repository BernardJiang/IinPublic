import * as fs from 'fs';
import * as path from 'path';

describe('Android API compatibility boundaries', () => {
  const androidSource = path.resolve(
    __dirname,
    '../../../android/app/src/main/java/com/iinpublic/app',
  );

  test('the Android 7 base manager does not statically reference Wi-Fi Aware framework classes', () => {
    const baseManager = fs.readFileSync(
      path.join(androidSource, 'NearbyConnectivityManager.kt'),
      'utf8',
    );
    const api26Provider = fs.readFileSync(
      path.join(androidSource, 'WifiAwareConnectivityProvider.kt'),
      'utf8',
    );
    const executableBaseManager = baseManager
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '');

    expect(executableBaseManager).not.toMatch(/android\.net\.wifi\.aware/);
    expect(executableBaseManager).not.toMatch(
      /\b(?:AttachCallback|DiscoverySession|PeerHandle|WifiAwareManager|WifiAwareNetworkSpecifier|WifiAwareSession)\b/,
    );
    expect(baseManager).toContain(
      'Class.forName("com.iinpublic.app.WifiAwareConnectivityProvider")',
    );
    expect(api26Provider).toContain('@RequiresApi(Build.VERSION_CODES.O)');
    expect(api26Provider).toContain('import android.net.wifi.aware.AttachCallback');
  });

  describe('WebView device permissions (camera / file picker / location)', () => {
    const manifest = fs.readFileSync(
      path.resolve(__dirname, '../../../android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    const mainActivity = fs.readFileSync(path.join(androidSource, 'MainActivity.kt'), 'utf8');

    test('the manifest declares CAMERA (no declaration = no Settings toggle and getUserMedia is denied) but keeps the camera optional', () => {
      expect(manifest).toMatch(/<uses-permission android:name="android\.permission\.CAMERA"\s*\/>/);
      expect(manifest).toMatch(/android\.hardware\.camera"\s+android:required="false"/);
    });

    test('the manifest does not silently widen to microphone: every web getUserMedia call is video-only', () => {
      expect(manifest).not.toMatch(/RECORD_AUDIO/);
    });

    test('MainActivity installs a WebChromeClient that answers getUserMedia, geolocation and file-chooser requests', () => {
      expect(mainActivity).toContain('webChromeClient = appChromeClient');
      expect(mainActivity).toContain('override fun onPermissionRequest');
      expect(mainActivity).toContain('override fun onGeolocationPermissionsShowPrompt');
      expect(mainActivity).toContain('override fun onShowFileChooser');
      expect(mainActivity).toContain('Manifest.permission.CAMERA');
    });

    test('device capabilities are only granted to the embedded node origin, and audio requests are denied', () => {
      expect(mainActivity).toMatch(/isTrustedOrigin\(request\.origin\)/);
      expect(mainActivity).toMatch(/all \{ it == PermissionRequest\.RESOURCE_VIDEO_CAPTURE \}/);
      expect(mainActivity).not.toContain('RESOURCE_AUDIO_CAPTURE');
    });
  });
});
