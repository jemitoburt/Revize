import {
  Alert,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  LOCATION_SEPARATOR,
  newId,
  outcomeLabel,
  type EquipmentType,
  type InspectionItem,
  type InspectionResult,
  type Photo,
} from '@revize/shared';
import { IconAlertTriangle, IconBan, IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import {
  useDeletePhoto,
  useDeleteResult,
  usePhotos,
  useRecordResult,
  useUploadPhoto,
} from '../api/hooks.js';
import { displayFields, formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { pickPhoto, preparePhoto } from '../platform/photos.js';
import { PhotoStrip, type LocalPhoto } from './PhotoStrip.js';

export interface ItemSheetProps {
  inspectionId: string;
  item: InspectionItem | null;
  type: EquipmentType | undefined;
  readOnly: boolean;
  onClose: () => void;
  /** After a result was saved (and its photos uploaded). */
  onSaved: (result: InspectionResult) => void;
}

type Choice = { outcome: 'ok' } | { outcome: 'defect'; takenOutOfService: boolean };

export function ItemSheet(props: ItemSheetProps) {
  return (
    <Drawer
      opened={props.item !== null}
      onClose={props.onClose}
      position="right"
      size="min(720px, 100%)"
      title={
        props.item && (
          <Group gap="sm">
            <Title order={2} ff="monospace">
              {props.item.itemNumber}
            </Title>
            <Text c="dimmed">{props.type?.name}</Text>
          </Group>
        )
      }
      zIndex={300}
    >
      {props.item && <SheetBody key={props.item.id} {...props} item={props.item} />}
    </Drawer>
  );
}

function SheetBody({
  inspectionId,
  item,
  type,
  readOnly,
  onClose,
  onSaved,
}: ItemSheetProps & { item: InspectionItem }) {
  const record = useRecordResult(inspectionId);
  const removeResult = useDeleteResult(inspectionId);
  const upload = useUploadPhoto();
  const deletePhoto = useDeletePhoto();
  const photos = usePhotos({ itemId: item.id, inspectionId });
  const current = item.result;
  // One result id per opened card: saving again (e.g. after a failed photo upload) repeats it.
  const resultId = useRef(current?.id ?? newId()).current;

  const [choice, setChoice] = useState<Choice | null>(
    current?.outcome === 'defect'
      ? { outcome: 'defect', takenOutOfService: current.takenOutOfService }
      : null,
  );
  const [description, setDescription] = useState(current?.defectDescription ?? '');
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [uploadingItemPhoto, setUploadingItemPhoto] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  // Object URLs of local photos are released when the card closes.
  const localUrls = useRef<string[]>([]);
  useEffect(() => () => localUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const itemPhotos = (photos.data ?? []).filter((p) => p.owner === 'item');
  const defectPhotos = (photos.data ?? []).filter((p) => p.owner === 'result');
  const fields = type ? displayFields(type.fieldDefinitions, item.fieldValues) : [];
  const saving = record.isPending || upload.isPending;

  const save = async (next: Choice) => {
    if (next.outcome === 'defect' && !description.trim()) {
      setDescriptionError('Popište závadu');
      return;
    }
    setDescriptionError(null);
    let result: InspectionResult;
    try {
      result = await record.mutateAsync({
        itemId: item.id,
        body: {
          id: resultId,
          outcome: next.outcome,
          defectDescription: next.outcome === 'defect' ? description.trim() : null,
          takenOutOfService: next.outcome === 'defect' && next.takenOutOfService,
          recordedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      notifyError(error);
      return;
    }
    // Defect photos belong to the result, so they go up once it exists.
    for (const photo of localPhotos) {
      try {
        await upload.mutateAsync({
          id: photo.id,
          file: photo.blob,
          owner: 'result',
          itemId: item.id,
          inspectionId,
          takenAt: new Date().toISOString(),
        });
        setLocalPhotos((list) => list.filter((p) => p.id !== photo.id));
      } catch (error) {
        setUploadFailed(true);
        notifyError(error);
        return;
      }
    }
    notifySaved(`${item.itemNumber}: ${outcomeLabel(result)}`);
    onSaved(result);
  };

  const addDefectPhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    try {
      const blob = await preparePhoto(file);
      const url = URL.createObjectURL(blob);
      localUrls.current.push(url);
      setLocalPhotos((list) => [...list, { id: newId(), blob, url }]);
    } catch (error) {
      notifyError(error);
    }
  };

  const addItemPhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    setUploadingItemPhoto(true);
    try {
      await upload.mutateAsync({
        id: newId(),
        file: await preparePhoto(file),
        owner: 'item',
        itemId: item.id,
        takenAt: new Date().toISOString(),
      });
    } catch (error) {
      notifyError(error);
    } finally {
      setUploadingItemPhoto(false);
    }
  };

  const confirmDelete = (photo: Photo) => {
    if (!window.confirm('Smazat fotku?')) return;
    deletePhoto.mutate({ id: photo.id }, { onError: notifyError });
  };

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text c="dimmed">
          {item.locationPath.length ? item.locationPath.join(LOCATION_SEPARATOR) : 'Bez umístění'}
        </Text>
        {item.qrCode && <Badge variant="light">QR {item.qrCode}</Badge>}
        {item.status === 'out_of_service' && <Badge color="red">Vyřazen z provozu</Badge>}
      </Group>

      {fields.length > 0 && (
        <SimpleGrid cols={2} spacing={6} verticalSpacing={4}>
          {fields.map((f) => (
            <div key={f.label}>
              <Text size="xs" c="dimmed">
                {f.label}
              </Text>
              <Text size="sm">{f.value}</Text>
            </div>
          ))}
        </SimpleGrid>
      )}

      {current && (
        <Alert
          color={current.outcome === 'ok' ? 'green' : 'orange'}
          title={`Zapsáno: ${outcomeLabel(current)}`}
        >
          {current.recordedByName}, {formatDateTime(current.recordedAt)}
          {current.defectDescription && <Text mt={4}>{current.defectDescription}</Text>}
        </Alert>
      )}

      <Divider label="Výsledek kontroly" labelPosition="left" />
      <SimpleGrid cols={3} spacing="sm">
        <Button
          size="xl"
          color="green"
          variant={current?.outcome === 'ok' ? 'filled' : 'light'}
          leftSection={<IconCheck />}
          disabled={readOnly}
          loading={saving && choice === null}
          onClick={() => {
            setChoice(null);
            void save({ outcome: 'ok' });
          }}
        >
          V pořádku
        </Button>
        <Button
          size="xl"
          color="orange"
          variant={choice?.outcome === 'defect' && !choice.takenOutOfService ? 'filled' : 'light'}
          leftSection={<IconAlertTriangle />}
          disabled={readOnly}
          onClick={() => setChoice({ outcome: 'defect', takenOutOfService: false })}
        >
          Závada
        </Button>
        <Button
          size="xl"
          color="red"
          variant={choice?.outcome === 'defect' && choice.takenOutOfService ? 'filled' : 'light'}
          leftSection={<IconBan />}
          disabled={readOnly}
          onClick={() => setChoice({ outcome: 'defect', takenOutOfService: true })}
        >
          Vyřadit
        </Button>
      </SimpleGrid>

      {choice?.outcome === 'defect' && (
        <Stack gap="sm">
          <Textarea
            label={choice.takenOutOfService ? 'Závada (vyřazení z provozu)' : 'Popis závady'}
            placeholder="Např. ohnutý stojan, chybí pojistka nosníku…"
            autosize
            minRows={3}
            data-autofocus
            value={description}
            error={descriptionError}
            disabled={readOnly}
            onChange={(e) => {
              setDescription(e.currentTarget.value);
              setDescriptionError(null);
            }}
          />
          <PhotoStrip
            title="Fotky závady"
            photos={defectPhotos}
            local={localPhotos}
            disabled={readOnly}
            onAdd={() => void addDefectPhoto()}
            onDelete={confirmDelete}
            onDeleteLocal={(p) => setLocalPhotos((list) => list.filter((x) => x.id !== p.id))}
          />
          {uploadFailed && (
            <Alert color="red">
              Výsledek je uložený, ale některé fotky se nenahrály. Zkuste znovu Uložit.
            </Alert>
          )}
          <Button
            size="lg"
            color={choice.takenOutOfService ? 'red' : 'orange'}
            loading={saving}
            disabled={readOnly}
            onClick={() => void save(choice)}
          >
            {choice.takenOutOfService ? 'Uložit a vyřadit z provozu' : 'Uložit závadu'}
          </Button>
        </Stack>
      )}

      <Divider />
      <PhotoStrip
        title="Fotky artiklu"
        description="Výrobní štítek, celkový pohled – zůstanou u artiklu i pro další kontroly."
        photos={itemPhotos}
        busy={uploadingItemPhoto}
        onAdd={() => void addItemPhoto()}
        onDelete={confirmDelete}
      />

      <Group justify="space-between" mt="md">
        {current && !readOnly ? (
          <Button
            variant="subtle"
            color="gray"
            loading={removeResult.isPending}
            onClick={() => {
              if (!window.confirm('Zrušit zapsaný výsledek? Artikl bude znovu nezkontrolovaný.'))
                return;
              removeResult.mutate(
                { itemId: item.id },
                { onSuccess: onClose, onError: notifyError },
              );
            }}
          >
            Zrušit výsledek
          </Button>
        ) : (
          <span />
        )}
        <Button variant="default" size="md" onClick={onClose}>
          Zavřít
        </Button>
      </Group>
    </Stack>
  );
}
