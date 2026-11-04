import {
  Alert,
  Badge,
  Button,
  Checkbox,
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
  FIT_LABELS,
  SEVERITY_LABELS,
  outcomeLabel,
  severityOf,
  type EquipmentType,
  type InspectionItem,
  type InspectionResult,
  type Photo,
  type Severity,
} from '@revize/shared';
import { IconAlertTriangle, IconBan, IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  useDeletePhoto,
  useDeleteResult,
  usePendingPhotos,
  usePhotos,
  useRecordResult,
  useUploadPhoto,
} from '../api/hooks.js';
import { displayFields, formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { pickPhoto, preparePhoto } from '../platform/photos.js';
import { cancelPhoto, saveDraftPhoto } from '../offline/outbox.js';
import { PhotoStrip, useLocalPhotos } from './PhotoStrip.js';
import { usePhotoEditor } from './PhotoEditor.js';

export interface ItemSheetProps {
  inspectionId: string;
  item: InspectionItem | null;
  type: EquipmentType | undefined;
  readOnly: boolean;
  onClose: () => void;
  /** After a result was saved (and its photos uploaded). */
  onSaved: (result: InspectionResult) => void;
}

type Choice = { outcome: 'ok' } | { outcome: 'defect'; severity: Severity };

const SEVERITY_BUTTONS: { severity: Severity; color: string; icon: typeof IconCheck }[] = [
  { severity: 'green', color: 'teal', icon: IconAlertTriangle },
  { severity: 'amber', color: 'yellow', icon: IconAlertTriangle },
  { severity: 'red', color: 'red', icon: IconBan },
];

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
            {props.item.designation && (
              <Title order={3} data-testid="designation">
                {props.item.designation}
              </Title>
            )}
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
  const phone = useMediaQuery('(max-width: 48em)') ?? false;
  const record = useRecordResult(inspectionId);
  const removeResult = useDeleteResult(inspectionId);
  const upload = useUploadPhoto();
  const deletePhoto = useDeletePhoto();
  const photos = usePhotos({ itemId: item.id, inspectionId });
  const photoEditor = usePhotoEditor();
  const current = item.result;
  // One result id per opened card: saving again (e.g. after a failed photo upload) repeats it.
  const resultId = useRef(current?.id ?? newId()).current;

  const [choice, setChoice] = useState<Choice | null>(
    current?.outcome === 'defect'
      ? { outcome: 'defect', severity: severityOf(current) ?? 'amber' }
      : null,
  );
  const [description, setDescription] = useState(current?.defectDescription ?? '');
  const [includeInProtocol, setIncludeInProtocol] = useState(current?.includeInProtocol ?? true);
  const [photosInProtocol, setPhotosInProtocol] = useState(current?.photosInProtocol ?? true);
  // Racks: risk levels of ČSN EN 15635. Other types: fit, a defect not preventing safe operation
  // (stored as green) or unfit (stored as red, out of service).
  const riskLevels = type?.riskLevels ?? true;
  const unfit = !riskLevels && choice?.outcome === 'defect' && choice.severity === 'red';
  const minor = !riskLevels && choice?.outcome === 'defect' && choice.severity === 'green';
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [busyItemPhoto, setBusyItemPhoto] = useState(false);
  // Photos on this device: drafts (defect photos before the result is saved) and unsent ones.
  const localDefect = useLocalPhotos(
    usePendingPhotos({ owner: 'result', itemId: item.id, inspectionId }),
  );
  const localItem = useLocalPhotos(usePendingPhotos({ owner: 'item', itemId: item.id }));
  const drafts = localDefect.filter((p) => p.draft);

  // Defect photos left from an unsaved card (app closed): show the defect form again.
  useEffect(() => {
    if (drafts.length > 0 && !choice) setChoice({ outcome: 'defect', severity: 'amber' });
  }, [drafts.length, choice]);

  const itemPhotos = (photos.data ?? []).filter((p) => p.owner === 'item');
  const defectPhotos = (photos.data ?? []).filter((p) => p.owner === 'result');
  const fields = type ? displayFields(type.fieldDefinitions, item.fieldValues) : [];
  const saving = record.isPending;

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
          severity: next.outcome === 'defect' ? next.severity : null,
          includeInProtocol: next.outcome === 'ok' || next.severity === 'red' || includeInProtocol,
          photosInProtocol: next.outcome === 'ok' || photosInProtocol,
          recordedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      notifyError(error);
      return;
    }
    // Defect photos belong to the result: queued after it, so they reach the server in order.
    try {
      for (const photo of next.outcome === 'defect' ? drafts : []) {
        await upload.mutateAsync({
          id: photo.id,
          file: photo.blob,
          owner: 'result',
          itemId: item.id,
          inspectionId,
          takenAt: photo.createdAt,
        });
      }
    } catch (error) {
      notifyError(error);
      return;
    }
    notifySaved(`${item.itemNumber}: ${outcomeLabel(result, riskLevels)}`);
    onSaved(result);
  };

  const addDefectPhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    const edit = await photoEditor.edit(file);
    if (!edit) return;
    try {
      // The defect is already recorded: the photo goes to it straight away (through the
      // outbox), so it cannot be forgotten on the device when the card is just closed.
      if (current?.outcome === 'defect') {
        await upload.mutateAsync({
          id: newId(),
          file: await preparePhoto(file, edit),
          owner: 'result',
          itemId: item.id,
          inspectionId,
          takenAt: new Date().toISOString(),
        });
        return;
      }
      await saveDraftPhoto({
        id: newId(),
        blob: await preparePhoto(file, edit),
        owner: 'result',
        itemId: item.id,
        inspectionId,
        draft: true,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      notifyError(error);
    }
  };

  const addItemPhoto = async () => {
    const file = await pickPhoto();
    if (!file) return;
    const edit = await photoEditor.edit(file);
    if (!edit) return;
    setBusyItemPhoto(true);
    try {
      await upload.mutateAsync({
        id: newId(),
        file: await preparePhoto(file, edit),
        owner: 'item',
        itemId: item.id,
        takenAt: new Date().toISOString(),
      });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusyItemPhoto(false);
    }
  };

  // Photos of a defect are taken from "Fotky artiklu" easily (it is the only photo button until
  // a result is chosen) and would then miss the protocol: unless the item is fine, ask.
  const askWherePhotoBelongs = () => {
    if (readOnly || (current?.outcome === 'ok' && !choice)) {
      void addItemPhoto();
      return;
    }
    const id = modals.open({
      title: 'Ke které části fotka patří?',
      zIndex: 400,
      centered: true,
      children: (
        <Stack>
          <Button
            size="lg"
            color="red"
            onClick={() => {
              modals.close(id);
              if (choice?.outcome !== 'defect') {
                setChoice({ outcome: 'defect', severity: riskLevels ? 'amber' : 'green' });
              }
              void addDefectPhoto();
            }}
          >
            K závadě (tiskne se do protokolu)
          </Button>
          <Button
            size="lg"
            variant="default"
            onClick={() => {
              modals.close(id);
              void addItemPhoto();
            }}
          >
            K artiklu (výrobní štítek, celkový pohled)
          </Button>
        </Stack>
      ),
    });
  };

  const confirmDelete = (photo: Photo) => {
    if (!window.confirm('Smazat fotku?')) return;
    deletePhoto.mutate({ id: photo.id }, { onError: notifyError });
  };

  return (
    <Stack gap="md">
      {photoEditor.editor}
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
          title={`Zapsáno: ${outcomeLabel(current, riskLevels)}`}
        >
          {current.recordedByName}, {formatDateTime(current.recordedAt)}
          {current.defectDescription && <Text mt={4}>{current.defectDescription}</Text>}
        </Alert>
      )}

      <Divider label="Výsledek kontroly" labelPosition="left" />
      <SimpleGrid cols={riskLevels ? { base: 2, sm: 4 } : { base: 1, sm: 3 }} spacing="sm">
        <Button
          size={phone ? 'lg' : 'xl'}
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
          {riskLevels ? 'V pořádku' : FIT_LABELS.ok}
        </Button>
        {!riskLevels && (
          <Button
            size={phone ? 'lg' : 'xl'}
            color="yellow"
            variant={minor ? 'filled' : 'light'}
            leftSection={<IconAlertTriangle />}
            disabled={readOnly}
            onClick={() => setChoice({ outcome: 'defect', severity: 'green' })}
          >
            {FIT_LABELS.minor}
          </Button>
        )}
        {!riskLevels && (
          <Button
            size={phone ? 'lg' : 'xl'}
            color="red"
            variant={unfit ? 'filled' : 'light'}
            leftSection={<IconBan />}
            disabled={readOnly}
            onClick={() => setChoice({ outcome: 'defect', severity: 'red' })}
          >
            {FIT_LABELS.defect}
          </Button>
        )}
        {(riskLevels ? SEVERITY_BUTTONS : []).map(({ severity, color, icon: Icon }) => (
          <Button
            key={severity}
            size={phone ? 'lg' : 'xl'}
            color={color}
            variant={
              choice?.outcome === 'defect' && choice.severity === severity ? 'filled' : 'light'
            }
            leftSection={<Icon />}
            disabled={readOnly}
            onClick={() => setChoice({ outcome: 'defect', severity })}
          >
            {SEVERITY_LABELS[severity].short}
          </Button>
        ))}
      </SimpleGrid>

      {choice?.outcome === 'defect' && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {unfit
              ? 'Závada bránící bezpečnému provozu: vybavení se vyřadí z užívání až do opravy.'
              : minor
                ? 'Závada nebránící bezpečnému provozu: vybavení zůstává v provozu, závada se zapíše do protokolu i s fotkami.'
                : SEVERITY_LABELS[choice.severity].hint}
          </Text>
          <Textarea
            label={
              choice.severity === 'red' && !unfit ? 'Závada (vyřazení z provozu)' : 'Popis závady'
            }
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
          <Checkbox
            size="md"
            label="Zahrnout fotky do protokolu"
            checked={photosInProtocol}
            disabled={readOnly}
            onChange={(e) => setPhotosInProtocol(e.currentTarget.checked)}
          />
          {riskLevels && choice.severity !== 'red' && (
            <Checkbox
              size="md"
              label="Zahrnout do protokolu"
              checked={includeInProtocol}
              disabled={readOnly}
              onChange={(e) => setIncludeInProtocol(e.currentTarget.checked)}
            />
          )}
          <PhotoStrip
            title="Fotky závady"
            photos={defectPhotos}
            local={localDefect}
            disabled={readOnly}
            onAdd={() => void addDefectPhoto()}
            onDelete={confirmDelete}
            onDeleteLocal={(p) => void cancelPhoto(p.id)}
          />
          <Button
            size="lg"
            color={
              choice.severity === 'red'
                ? 'red'
                : choice.severity === 'amber' || minor
                  ? 'yellow'
                  : 'teal'
            }
            loading={saving}
            disabled={readOnly}
            onClick={() => void save(choice)}
          >
            {unfit
              ? 'Uložit – nevyhovuje'
              : choice.severity === 'red'
                ? 'Uložit a vyřadit z provozu'
                : 'Uložit závadu'}
          </Button>
        </Stack>
      )}

      <Divider />
      <PhotoStrip
        title="Fotky artiklu"
        description="Výrobní štítek, celkový pohled – zůstanou u artiklu i pro další kontroly."
        photos={itemPhotos}
        local={localItem}
        busy={busyItemPhoto}
        onAdd={askWherePhotoBelongs}
        onDelete={confirmDelete}
        onDeleteLocal={(p) => void cancelPhoto(p.id)}
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
