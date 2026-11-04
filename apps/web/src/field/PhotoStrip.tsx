import { ActionIcon, Box, Button, Group, Image, Loader, Modal, Stack, Text } from '@mantine/core';
import type { Photo } from '@revize/shared';
import { IconCamera, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoBlobRow } from '../platform/local-db.js';
import { usePhotoUrl } from '../api/hooks.js';

/** A photo taken on this device that is not on the server yet. */
export interface LocalPhoto {
  id: string;
  blob: Blob;
  url: string;
  draft: boolean;
  createdAt: string;
}

/** Object URLs for photos stored on the device, released when they disappear. */
export function useLocalPhotos(rows: readonly PhotoBlobRow[]): LocalPhoto[] {
  const urls = useRef(new Map<string, string>());
  const photos = useMemo(
    () =>
      rows.map((row) => {
        let url = urls.current.get(row.id);
        if (!url) {
          url = URL.createObjectURL(row.blob);
          urls.current.set(row.id, url);
        }
        return { id: row.id, blob: row.blob, url, draft: row.draft, createdAt: row.createdAt };
      }),
    [rows],
  );
  useEffect(() => {
    const ids = new Set(rows.map((r) => r.id));
    for (const [id, url] of urls.current) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
    }
  }, [rows]);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  return photos;
}

const SIZE = 88;

function Thumb({ src, alt, onOpen }: { src: string | undefined; alt: string; onOpen: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      aria-label={alt}
      style={{
        width: SIZE,
        height: SIZE,
        padding: 0,
        border: '1px solid var(--mantine-color-gray-4)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--mantine-color-gray-1)',
        cursor: 'pointer',
      }}
    >
      {src ? (
        <Image src={src} alt="" w={SIZE} h={SIZE} fit="cover" />
      ) : (
        <Loader size="sm" m="auto" mt={30} />
      )}
    </Box>
  );
}

function ServerThumb({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  return <Thumb src={usePhotoUrl(photo.id, 'thumbnail')} alt="Zobrazit fotku" onOpen={onOpen} />;
}

function FullPhoto({ photo }: { photo: Photo }) {
  const src = usePhotoUrl(photo.id, 'original');
  return src ? <Image src={src} alt="Fotka" fit="contain" mah="75vh" /> : <Loader m="xl" />;
}

export interface PhotoStripProps {
  title: string;
  description?: string;
  photos: Photo[];
  /** Taken but not yet uploaded (e.g. defect photos before the result is saved). */
  local?: LocalPhoto[];
  busy?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onDelete: (photo: Photo) => void;
  onDeleteLocal?: (photo: LocalPhoto) => void;
  /** Another action on an uploaded photo in the full view (office: move it). */
  photoAction?: { label: string; onClick: (photo: Photo) => void };
}

/** Thumbnails with "add" and a full-size view that can delete the photo. */
export function PhotoStrip({
  title,
  description,
  photos,
  local = [],
  busy,
  disabled,
  onAdd,
  onDelete,
  onDeleteLocal,
  photoAction,
}: PhotoStripProps) {
  const [open, setOpen] = useState<{ server: Photo } | { local: LocalPhoto } | null>(null);
  const count = photos.length + local.length;

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Text fw={600}>
            {title} {count > 0 && `(${count})`}
          </Text>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </div>
        <Button
          variant="light"
          leftSection={<IconCamera size={18} />}
          onClick={onAdd}
          loading={busy}
          disabled={disabled}
        >
          Vyfotit
        </Button>
      </Group>
      {count > 0 && (
        <Group gap="xs">
          {photos.map((p) => (
            <ServerThumb key={p.id} photo={p} onOpen={() => setOpen({ server: p })} />
          ))}
          {local.map((p) => (
            <Thumb
              key={p.id}
              src={p.url}
              alt="Zobrazit fotku"
              onOpen={() => setOpen({ local: p })}
            />
          ))}
        </Group>
      )}
      <Modal opened={open !== null} onClose={() => setOpen(null)} size="xl" title={title} centered>
        {open && (
          <Stack>
            {'server' in open ? (
              <FullPhoto photo={open.server} />
            ) : (
              <Image src={open.local.url} alt="Fotka" fit="contain" mah="75vh" />
            )}
            <Group justify="space-between">
              {'local' in open && (
                <Text size="sm" c="dimmed">
                  {open.local.draft
                    ? 'Uložená v zařízení, odešle se po uložení výsledku.'
                    : 'Uložená v zařízení, čeká na odeslání.'}
                </Text>
              )}
              {'server' in open && photoAction && (
                <Button
                  variant="light"
                  disabled={disabled}
                  onClick={() => {
                    photoAction.onClick(open.server);
                    setOpen(null);
                  }}
                >
                  {photoAction.label}
                </Button>
              )}
              <ActionIcon
                ml="auto"
                variant="light"
                color="red"
                size="xl"
                aria-label="Smazat fotku"
                disabled={disabled}
                onClick={() => {
                  if ('server' in open) onDelete(open.server);
                  else onDeleteLocal?.(open.local);
                  setOpen(null);
                }}
              >
                <IconTrash />
              </ActionIcon>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
