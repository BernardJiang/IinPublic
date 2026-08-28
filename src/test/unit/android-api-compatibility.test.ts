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
});
