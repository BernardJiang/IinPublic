interface BarcodeDetectorResultLike {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResultLike[]>;
}

type BarcodeDetectorConstructorLike = new (options: { formats: string[] }) => BarcodeDetectorLike;

export async function renderLinkCodeQr(canvas: HTMLCanvasElement, code: string): Promise<void> {
  const { default: QRCode } = await import('qrcode');
  await QRCode.toCanvas(canvas, code, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 180,
    color: { dark: '#111111', light: '#ffffff' },
  });
  canvas.dataset.rendered = 'true';
}

export function isQrCameraScanSupported(): boolean {
  const detector = (globalThis as typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorConstructorLike;
  }).BarcodeDetector;
  return typeof detector === 'function' && typeof navigator?.mediaDevices?.getUserMedia === 'function';
}

/**
 * Start a capability-gated QR camera reader. Scanning only fills the pairing
 * input; the user still presses Link to provide explicit approval.
 */
export async function startQrCameraScan(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<() => void> {
  const Detector = (globalThis as typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorConstructorLike;
  }).BarcodeDetector;
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('QR camera scanning is unavailable');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  });
  const detector = new Detector({ formats: ['qr_code'] });
  let stopped = false;
  let timer: number | undefined;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
  };

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch (error) {
    stop();
    throw error;
  }

  const detect = async (): Promise<void> => {
    if (stopped) return;
    try {
      const results = await detector.detect(video);
      const code = results.find((result) => typeof result.rawValue === 'string' && result.rawValue.trim())
        ?.rawValue?.trim();
      if (code) {
        onCode(code);
        stop();
        return;
      }
    } catch {
      // A frame can be unavailable while video starts; keep scanning.
    }
    if (!stopped) timer = window.setTimeout(() => void detect(), 200);
  };
  void detect();
  return stop;
}
