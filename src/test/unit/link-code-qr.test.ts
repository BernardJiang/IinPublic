/** @jest-environment jsdom */
import { isQrCameraScanSupported } from '../../web/ui/link-code-qr';

describe('QR camera capability gate', () => {
  const originalDetector = (globalThis as any).BarcodeDetector;
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: originalDetector,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it('requires both BarcodeDetector and getUserMedia', () => {
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn() },
    });
    expect(isQrCameraScanSupported()).toBe(false);

    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: class BarcodeDetector {},
    });
    expect(isQrCameraScanSupported()).toBe(true);
  });
});
