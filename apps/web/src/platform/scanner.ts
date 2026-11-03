import {
  ScanSession,
  ZxingWorkerEngine,
  attachKeyboardWedge,
  createWebFeedback,
  openCamera,
  type CameraHandle,
  type ScanFeedback,
} from '@revize/scanner';
import DecodeWorker from '@revize/scanner/decode-worker?worker';

/**
 * Camera and scanner access of the field mode (ADR-0003: platform access only through
 * `src/platform/`; a Capacitor build would replace this module). Settings are the ones tuned
 * in the iPad tests of the QR spike (ADR-0009): central code only, three matching reads, a short
 * pause after each scan so that neighbouring labels on a sheet are not picked up by accident.
 */
const SCAN_SETTINGS = {
  roiFraction: 0.6,
  maxDecodeSide: 720,
  cooldownMs: 2500,
  confirmHits: 3,
  rearmDelayMs: 800,
  centerZone: 0.25,
} as const;

export interface CameraScanner {
  readonly torchSupported: boolean;
  readonly zoomPresets: number[];
  setTorch(on: boolean): Promise<void>;
  setZoom(value: number): Promise<void>;
  /** Stops decoding (e.g. while the item card is open); the camera keeps running. */
  pause(): void;
  /** Continues after the card was closed; the same code is not read again right away. */
  resume(): Promise<void>;
  stop(): void;
}

export interface CameraScannerOptions {
  video: HTMLVideoElement;
  onScan: (text: string) => void;
  onError: (message: string) => void;
}

export async function startCameraScanner({
  video,
  onScan,
  onError,
}: CameraScannerOptions): Promise<CameraScanner> {
  let camera: CameraHandle = await openCamera(video, { idealWidth: 1920, idealHeight: 1080 });
  const engine = new ZxingWorkerEngine(() => new DecodeWorker(), {
    tryHarder: true,
    formats: ['QRCode'],
    maxSymbols: 4,
  });
  try {
    await engine.init();
  } catch (error) {
    camera.stop();
    throw error;
  }
  const session = new ScanSession({
    video,
    engine,
    ...SCAN_SETTINGS,
    pauseOnScan: true,
    onScan: (scan) => onScan(scan.text),
    onError: (error) => onError(error.message),
  });
  session.start();

  let wakeLock: WakeLockSentinel | null = null;
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
  const zoom = camera.zoom;

  return {
    torchSupported: camera.torchSupported,
    zoomPresets: zoom ? [1, 2, 3].filter((z) => z >= zoom.min && z <= zoom.max) : [],
    setTorch: (on) => camera.setTorch(on),
    setZoom: (value) => camera.setZoom(value),
    pause: () => session.pause(),
    async resume() {
      // Taking a photo with the system camera can end our stream on iOS: reopen it.
      if (camera.track.readyState === 'ended') {
        camera.stop();
        camera = await openCamera(video, { idealWidth: 1920, idealHeight: 1080 });
      } else if (video.paused) {
        await video.play().catch(() => undefined);
      }
      session.resume();
    },
    stop() {
      session.stop();
      engine.dispose();
      camera.stop();
      void wakeLock?.release().catch(() => undefined);
    },
  };
}

/** Bluetooth/USB scanners in keyboard mode; returns a function that stops listening. */
export function listenForHardwareScanner(onScan: (text: string) => void): () => void {
  return attachKeyboardWedge(onScan);
}

/** Beep on a found / unknown code. `unlock()` must run inside a tap (iOS audio rules). */
export const scanFeedback: ScanFeedback = createWebFeedback({ sound: true, iosSwitchHaptic: true });
