import { Box, Button, Center, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconMaximize, IconRotate2, IconRotateClockwise2 } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  FULL_CROP,
  dragCrop,
  isFullCrop,
  rotateCrop,
  turn,
  type CropHandle,
  type CropRect,
  type Rotation,
} from '../lib/crop.js';
import { editToJpeg } from '../lib/images.js';
import type { PhotoEdit } from '../platform/photos.js';

/** Preview size: enough for the screen, small enough to turn quickly. */
const PREVIEW_SIDE = 1400;
const HANDLES: Exclude<CropHandle, 'move'>[] = ['nw', 'ne', 'sw', 'se'];
const HANDLE_SIZE = 44;

/**
 * Photo editor shown right after a photo is taken: turn by 90° and cut out a part. Returns the
 * chosen edit (applied later to the original photo) or null when the technician drops the photo.
 */
export function usePhotoEditor(): {
  editor: ReactNode;
  edit: (file: Blob) => Promise<PhotoEdit | null>;
} {
  const [open, setOpen] = useState<{ file: Blob; resolve: (e: PhotoEdit | null) => void } | null>(
    null,
  );
  const edit = useCallback(
    (file: Blob) => new Promise<PhotoEdit | null>((resolve) => setOpen({ file, resolve })),
    [],
  );
  const finish = (result: PhotoEdit | null) => {
    open?.resolve(result);
    setOpen(null);
  };
  const editor = (
    <Modal
      opened={open !== null}
      onClose={() => finish(null)}
      fullScreen
      zIndex={400}
      title="Upravit fotku"
      styles={{ body: { padding: 'var(--mantine-spacing-sm)' } }}
    >
      {open && <EditorBody file={open.file} onDone={finish} />}
    </Modal>
  );
  return { editor, edit };
}

function EditorBody({ file, onDone }: { file: Blob; onDone: (e: PhotoEdit | null) => void }) {
  const [rotation, setRotation] = useState<Rotation>(0);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [preview, setPreview] = useState<{
    url: string;
    rotation: Rotation;
    width: number;
    height: number;
  } | null>(null);
  const area = useElementSize();
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: CropRect } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    editToJpeg(file, { rotation, crop: FULL_CROP }, PREVIEW_SIDE, 0.8)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        const image = new Image();
        const shown = url;
        image.onload = () =>
          !cancelled &&
          setPreview({
            url: shown,
            rotation,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        image.onerror = () => !cancelled && setFailed(true);
        image.src = url;
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, rotation]);

  const rotate = (clockwise: boolean) => {
    setRotation((r) => turn(r, clockwise));
    setCrop((c) => rotateCrop(c, clockwise));
  };

  const start = (handle: CropHandle) => (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, x: event.clientX, y: event.clientY, start: crop };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!current || !box) return;
    setCrop(
      dragCrop(
        current.start,
        current.handle,
        (event.clientX - current.x) / box.width,
        (event.clientY - current.y) / box.height,
      ),
    );
  };
  const end = () => {
    drag.current = null;
  };
  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  // The photo fitted into the free space above the buttons.
  const fit =
    preview && area.width > 0 && area.height > 0
      ? Math.min(area.width / preview.width, area.height / preview.height)
      : 0;

  if (failed) {
    // An unreadable photo cannot be edited, but it can still be saved as it is.
    return (
      <Stack>
        <Text>Fotku nelze upravit v tomto prohlížeči.</Text>
        <Group grow>
          <Button variant="default" size="lg" onClick={() => onDone(null)}>
            Zahodit
          </Button>
          <Button size="lg" onClick={() => onDone({ rotation: 0, crop: FULL_CROP })}>
            Uložit bez úprav
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="sm" h="calc(100dvh - 80px)">
      <Center ref={area.ref} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {preview?.rotation === rotation && fit > 0 ? (
          <Box
            ref={frame}
            pos="relative"
            w={preview.width * fit}
            h={preview.height * fit}
            style={{ lineHeight: 0, overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}
          >
            <img
              src={preview.url}
              alt="Upravovaná fotka"
              data-rotation={rotation}
              draggable={false}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
            <Box
              data-testid="crop"
              onPointerDown={start('move')}
              {...pointer}
              style={{
                position: 'absolute',
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
                border: '2px solid white',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                cursor: 'move',
              }}
            >
              {HANDLES.map((handle) => (
                <Box
                  key={handle}
                  aria-label={`Roh výřezu ${handle}`}
                  onPointerDown={start(handle)}
                  {...pointer}
                  style={{
                    position: 'absolute',
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    // Inside the corner: never cut off by the edge of the photo.
                    [handle.startsWith('n') ? 'top' : 'bottom']: -2,
                    [handle.endsWith('w') ? 'left' : 'right']: -2,
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                >
                  <Box
                    style={{
                      position: 'absolute',
                      width: 22,
                      height: 22,
                      [handle.startsWith('n') ? 'top' : 'bottom']: 0,
                      [handle.endsWith('w') ? 'left' : 'right']: 0,
                      [handle.startsWith('n') ? 'borderTop' : 'borderBottom']: '5px solid white',
                      [handle.endsWith('w') ? 'borderLeft' : 'borderRight']: '5px solid white',
                      filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.9))',
                    }}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        ) : (
          <Loader />
        )}
      </Center>
      <Text size="xs" c="dimmed" ta="center">
        Táhněte za rohy, výřez posunete tažením uprostřed.
      </Text>
      <Group grow gap="xs">
        <Button
          variant="default"
          size="md"
          px="xs"
          leftSection={<IconRotate2 size={20} />}
          onClick={() => rotate(false)}
        >
          Doleva
        </Button>
        <Button
          variant="default"
          size="md"
          px="xs"
          leftSection={<IconRotateClockwise2 size={20} />}
          onClick={() => rotate(true)}
        >
          Doprava
        </Button>
        <Button
          variant="default"
          size="md"
          px="xs"
          leftSection={<IconMaximize size={20} />}
          disabled={isFullCrop(crop)}
          onClick={() => setCrop(FULL_CROP)}
        >
          Celá
        </Button>
      </Group>
      <Group grow gap="xs">
        <Button variant="default" size="lg" color="red" onClick={() => onDone(null)}>
          Zahodit
        </Button>
        <Button
          size="lg"
          disabled={preview?.rotation !== rotation}
          onClick={() => onDone({ rotation, crop })}
        >
          Uložit fotku
        </Button>
      </Group>
    </Stack>
  );
}
