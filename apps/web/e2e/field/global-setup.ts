import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import sharp from 'sharp';

// Fake camera and photo for the field e2e (Chromium plays the Y4M in a loop as the camera).
export const GENERATED = 'e2e/.generated';
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 15;

/** A grey frame with one QR label under the crosshair, as raw YUV 4:2:0 (no ffmpeg needed). */
function writeQrVideo(path: string, text: string) {
  const luma = new Uint8Array(WIDTH * HEIGHT).fill(128);
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const margin = 4;
  const cells = modules.size + 2 * margin;
  const px = Math.floor(240 / cells);
  const [x0, y0] = [520, 240];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const [mx, my] = [cx - margin, cy - margin];
      const dark =
        mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(my, mx);
      for (let dy = 0; dy < px; dy++) {
        const row = (y0 + cy * px + dy) * WIDTH + x0 + cx * px;
        luma.fill(dark ? 0 : 255, row, row + px);
      }
    }
  }
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2) * 2).fill(128);
  const encoder = new TextEncoder();
  const parts = [encoder.encode(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < FPS * 2; i++) parts.push(encoder.encode('FRAME\n'), luma, chroma);
  const video = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    video.set(part, offset);
    offset += part.length;
  }
  writeFileSync(path, video);
}

export default async function globalSetup() {
  mkdirSync(GENERATED, { recursive: true });
  writeQrVideo(`${GENERATED}/qr-R10001.y4m`, 'https://revize.example/q/R10001');
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#b45309' } })
    .jpeg()
    .toFile(`${GENERATED}/defect.jpg`);
}
