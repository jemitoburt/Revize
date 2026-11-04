import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  FIT_LABELS,
  SEVERITY_LABELS,
  newId,
  outcomeLabel,
  severityOf,
  type EquipmentType,
  type InspectionItem,
  type Photo,
  type Severity,
} from '@revize/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  useDeletePhoto,
  useItem,
  useMovePhoto,
  useOfficeRecordResult,
  usePhotos,
  useUploadPhoto,
} from '../api/hooks.js';
import { usePhotoEditor } from '../field/PhotoEditor.js';
import { PhotoStrip } from '../field/PhotoStrip.js';
import { formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { pickPhoto, preparePhoto } from '../platform/photos.js';
import { ItemForm } from './ItemForm.js';

/** Result as chosen in the office: OK or a defect level (fit / unfit types: only red). */
type Choice = 'ok' | Severity;

export interface InspectionItemDrawerProps {
  inspectionId: string;
  item: InspectionItem | null;
  type: EquipmentType | undefined;
  /** The inspection is open: result and photos can be changed. */
  editable: boolean;
  onClose: () => void;
}

/**
 * Office: one item of an inspection – its result (outcome, description, protocol flags), the
 * photos (view, add, delete, move between item and defect) and the item itself.
 */
export function InspectionItemDrawer(props: InspectionItemDrawerProps) {
  return (
    <Drawer
      opened={props.item !== null}
      onClose={props.onClose}
      position="right"
      size="xl"
      title={
        props.item && (
          <Group gap="sm">
            <Title order={3} ff="monospace">
              {props.item.itemNumber}
            </Title>
            {props.item.designation && <Title order={4}>{props.item.designation}</Title>}
            <Text c="dimmed">{props.type?.name}</Text>
          </Group>
        )
      }
    >
      {props.item && <Body key={props.item.id} {...props} item={props.item} />}
    </Drawer>
  );
}

function Body({
  inspectionId,
  item,
  type,
  editable,
}: InspectionItemDrawerProps & { item: InspectionItem }) {
  const riskLevels = type?.riskLevels ?? true;
  const current = item.result;
  const record = useOfficeRecordResult(inspectionId);
  const [choice, setChoice] = useState<Choice | null>(
    current ? (severityOf(current) ?? 'ok') : null,
  );
  const [description, setDescription] = useState(current?.defectDescription ?? '');
  const [includeInProtocol, setIncludeInProtocol] = useState(current?.includeInProtocol ?? true);
  const [photosInProtocol, setPhotosInProtocol] = useState(current?.photosInProtocol ?? true);
  const [error, setError] = useState<string | null>(null);
  const defect = choice !== null && choice !== 'ok';

  const options = riskLevels
    ? [
        { value: 'ok', label: 'V pořádku' },
        ...(['green', 'amber', 'red'] as const).map((s) => ({
          value: s,
          label: SEVERITY_LABELS[s].short,
        })),
      ]
    : [
        { value: 'ok', label: FIT_LABELS.ok },
        { value: 'green', label: FIT_LABELS.minor },
        { value: 'red', label: FIT_LABELS.defect },
      ];

  const save = () => {
    if (!choice) return;
    if (defect && !description.trim()) {
      setError('Popište závadu');
      return;
    }
    setError(null);
    record.mutate(
      {
        itemId: item.id,
        body: {
          id: current?.id ?? newId(),
          outcome: defect ? 'defect' : 'ok',
          severity: defect ? choice : null,
          defectDescription: defect ? description.trim() : null,
          includeInProtocol: !defect || choice === 'red' || includeInProtocol,
          photosInProtocol: !defect || photosInProtocol,
          recordedAt: new Date().toISOString(),
        },
      },
      { onSuccess: () => notifySaved(), onError: notifyError },
    );
  };

  return (
    <Stack gap="md">
      <Text c="dimmed">{item.locationPath.join(' › ') || 'Bez umístění'}</Text>

      <Divider label="Výsledek kontroly" labelPosition="left" />
      {current && (
        <Text size="sm" c="dimmed">
          Zapsáno: {outcomeLabel(current, riskLevels)} – {current.recordedByName},{' '}
          {formatDateTime(current.recordedAt)}
        </Text>
      )}
      {!editable && (
        <Alert color="gray">Kontrola je uzavřená, výsledek a fotky jsou jen pro čtení.</Alert>
      )}
      <SegmentedControl
        data={options}
        value={choice ?? ''}
        disabled={!editable}
        onChange={(v) => setChoice(v as Choice)}
        aria-label="Výsledek"
      />
      {defect && (
        <>
          <Textarea
            label="Popis závady"
            autosize
            minRows={2}
            value={description}
            error={error}
            disabled={!editable}
            onChange={(e) => {
              setDescription(e.currentTarget.value);
              setError(null);
            }}
          />
          {riskLevels && choice !== 'red' && (
            <Checkbox
              label="Zahrnout do protokolu"
              checked={includeInProtocol}
              disabled={!editable}
              onChange={(e) => setIncludeInProtocol(e.currentTarget.checked)}
            />
          )}
          <Checkbox
            label="Zahrnout fotky do protokolu"
            checked={photosInProtocol}
            disabled={!editable}
            onChange={(e) => setPhotosInProtocol(e.currentTarget.checked)}
          />
        </>
      )}
      {editable && (
        <Group>
          <Button onClick={save} loading={record.isPending} disabled={!choice}>
            Uložit výsledek
          </Button>
        </Group>
      )}

      <Photos inspectionId={inspectionId} item={item} editable={editable} />

      <Divider label="Artikl" labelPosition="left" />
      <ItemSection itemId={item.id} inspectionId={inspectionId} />
    </Stack>
  );
}

function Photos({
  inspectionId,
  item,
  editable,
}: {
  inspectionId: string;
  item: InspectionItem;
  editable: boolean;
}) {
  const photos = usePhotos({ itemId: item.id, inspectionId });
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const move = useMovePhoto(inspectionId);
  const editor = usePhotoEditor();
  const client = useQueryClient();
  const all = photos.data ?? [];
  const defectPhotos = all.filter((p) => p.owner === 'result');
  const itemPhotos = all.filter((p) => p.owner === 'item');
  const hasResult = item.result !== null;

  const add = async (owner: 'result' | 'item') => {
    const file = await pickPhoto();
    if (!file) return;
    const edit = await editor.edit(file);
    if (!edit) return;
    try {
      await upload.mutateAsync({
        id: newId(),
        file: await preparePhoto(file, edit),
        owner,
        itemId: item.id,
        ...(owner === 'result' ? { inspectionId } : {}),
        takenAt: new Date().toISOString(),
      });
      void client.invalidateQueries({ queryKey: ['photos'] });
      void client.invalidateQueries({ queryKey: ['inspection-items', inspectionId] });
    } catch (error) {
      notifyError(error);
    }
  };
  const confirmDelete = (photo: Photo) => {
    if (!window.confirm('Smazat fotku?')) return;
    remove.mutate({ id: photo.id }, { onError: notifyError });
  };
  const moveTo = (owner: 'item' | 'result') => (photo: Photo) =>
    move.mutate(
      { id: photo.id, owner },
      {
        onSuccess: () =>
          notifySaved(owner === 'result' ? 'Přesunuto k závadě' : 'Přesunuto k artiklu'),
        onError: notifyError,
      },
    );

  if (photos.isPending) return <Loader size="sm" />;
  return (
    <>
      {editor.editor}
      <PhotoStrip
        title="Fotky závady"
        description="Tisknou se do protokolu u závady."
        photos={defectPhotos}
        disabled={!editable || !hasResult}
        onAdd={() => void add('result')}
        onDelete={confirmDelete}
        photoAction={
          editable ? { label: 'Přesunout k artiklu', onClick: moveTo('item') } : undefined
        }
      />
      <PhotoStrip
        title="Fotky artiklu"
        description="Výrobní štítek, celkový pohled – zůstávají u artiklu, do protokolu se netisknou."
        photos={itemPhotos}
        onAdd={() => void add('item')}
        onDelete={confirmDelete}
        photoAction={
          editable && hasResult
            ? { label: 'Přesunout k závadě', onClick: moveTo('result') }
            : undefined
        }
      />
    </>
  );
}

function ItemSection({ itemId, inspectionId }: { itemId: string; inspectionId: string }) {
  const item = useItem(itemId);
  const client = useQueryClient();
  if (item.isPending) return <Loader size="sm" />;
  if (item.error) return <Alert color="red">{item.error.message}</Alert>;
  return (
    <ItemForm
      key={item.data.version}
      item={item.data}
      fixedSite
      onDone={() => {
        notifySaved();
        void client.invalidateQueries({ queryKey: ['inspection-items', inspectionId] });
      }}
    />
  );
}
