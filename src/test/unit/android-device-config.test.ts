import { configuredAndroidDevices, resolveAndroidMatrixDevices } from '../../../tests/e2e/native-app/helpers/android-device-config';

describe('Android logical device selection', () => {
  test('selects configured devices by logical name in the requested order', () => {
    const configured = configuredAndroidDevices();
    expect(configured.length).toBeGreaterThanOrEqual(2);
    expect(resolveAndroidMatrixDevices('', `${configured[1].name},${configured[0].name}`)).toEqual([
      configured[1],
      configured[0],
    ]);
  });

  test('rejects unknown names and ambiguous name-plus-serial selectors', () => {
    expect(() => resolveAndroidMatrixDevices('', 'android-does-not-exist')).toThrow(
      'Unknown Android logical name',
    );
    expect(() => resolveAndroidMatrixDevices('serial', 'android-alice')).toThrow(
      'logical name or serial',
    );
  });
});
