import { Box, Button, Group, Text } from '@mantine/core';
import { IconBulb, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { startCameraScanner, type CameraScanner } from '../platform/scanner.js';

export interface ScannerOverlayProps {
  /** While the item card is open, decoding is paused and the camera keeps running. */
  paused: boolean;
  progressLabel: string;
  onCode: (text: string) => void;
  onClose: () => void;
}

/** Full-screen camera with the scan square; stays open between items ("rychlá kontrola"). */
export function ScannerOverlay({ paused, progressLabel, onCode, onClose }: ScannerOverlayProps) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<CameraScanner | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [status, setStatus] = useState('Spouštím kameru…');
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({
    supported: false,
    on: false,
  });
  const [zoomPresets, setZoomPresets] = useState<number[]>([]);

  useEffect(() => {
    let disposed = false;
    let running: CameraScanner | null = null;
    const start = async () => {
      try {
        const started = await startCameraScanner({
          video: video.current!,
          onScan: (text) => onCodeRef.current(text),
          onError: (message) => setStatus(`Chyba dekodéru: ${message}`),
        });
        if (disposed) {
          started.stop();
          return;
        }
        running = started;
        scanner.current = started;
        setTorch({ supported: started.torchSupported, on: false });
        setZoomPresets(started.zoomPresets);
        setStatus('Zaměřte kříž na QR kód');
      } catch (error) {
        setStatus(`Kameru nelze spustit: ${String(error)}`);
      }
    };
    const stop = () => {
      running?.stop();
      running = null;
      scanner.current = null;
    };
    // The camera is released when the app goes to the background and reopened on return.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (!running) void start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void start();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);

  useEffect(() => {
    if (paused) scanner.current?.pause();
    else void scanner.current?.resume();
  }, [paused]);

  const roi = '60vmin';
  return (
    <Box pos="fixed" inset={0} bg="black" style={{ zIndex: 250 }} data-testid="scanner">
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <Box
        pos="absolute"
        top="50%"
        left="50%"
        w={roi}
        h={roi}
        style={{
          transform: 'translate(-50%, -50%)',
          border: '3px solid rgba(255,255,255,0.9)',
          borderRadius: 16,
          boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)',
        }}
      >
        <Box
          pos="absolute"
          top="50%"
          left="50%"
          w={36}
          h={36}
          style={{
            transform: 'translate(-50%, -50%)',
            borderLeft: '2px solid #fff',
            borderTop: '2px solid #fff',
            rotate: '45deg',
            opacity: 0.6,
          }}
        />
      </Box>
      <Group pos="absolute" top={0} left={0} right={0} p="md" justify="space-between">
        <Button size="lg" color="dark" leftSection={<IconX />} onClick={onClose}>
          Zavřít
        </Button>
        <Text c="white" fw={600} size="lg">
          {progressLabel}
        </Text>
        {torch.supported ? (
          <Button
            size="lg"
            color={torch.on ? 'yellow' : 'dark'}
            leftSection={<IconBulb />}
            onClick={() => {
              const on = !torch.on;
              setTorch({ supported: true, on });
              void scanner.current?.setTorch(on);
            }}
          >
            Svítilna
          </Button>
        ) : (
          <span />
        )}
      </Group>
      <Group pos="absolute" bottom={0} left={0} right={0} p="lg" justify="center" gap="sm">
        {zoomPresets.map((z) => (
          <Button key={z} size="md" color="dark" onClick={() => void scanner.current?.setZoom(z)}>
            {z}×
          </Button>
        ))}
        <Text c="white" w="100%" ta="center">
          {status}
        </Text>
      </Group>
    </Box>
  );
}
