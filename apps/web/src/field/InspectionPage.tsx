import {
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  LOCATION_SEPARATOR,
  canonicalItemNumber,
  findScannedItem,
  newId,
  outcomeLabel,
  parseScanPayload,
  progressOf,
  severityOf,
  type EquipmentType,
  type InspectionItem,
  type InspectionResult,
  type Photo,
} from '@revize/shared';
import {
  IconArrowLeft,
  IconCamera,
  IconCloudUpload,
  IconDialpad,
  IconFlag,
  IconPlus,
  IconQrcode,
  IconSearch,
} from '@tabler/icons-react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useDeletePhoto,
  useEquipmentTypes,
  useInspection,
  useCreateFieldItem,
  useInspectionItems,
  useOutbox,
  usePendingPhotos,
  usePhotos,
  useUploadPhoto,
} from '../api/hooks.js';
import { ItemForm } from '../components/ItemForm.js';
import { ButtonLink } from '../components/links.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { cancelPhoto } from '../offline/outbox.js';
import { pickPhoto, preparePhoto } from '../platform/photos.js';
import { listenForHardwareScanner, scanFeedback } from '../platform/scanner.js';
import { ItemSheet } from './ItemSheet.js';
import { NumberPad } from './NumberPad.js';
import { PhotoStrip, useLocalPhotos } from './PhotoStrip.js';
import { ScannerOverlay } from './ScannerOverlay.js';

type Filter = 'unchecked' | 'defects' | 'all';
type Source = 'list' | 'scan';

const SEVERITY_COLORS = { green: 'teal', amber: 'orange', red: 'red' } as const;

function resultColor(result: InspectionResult) {
  const severity = severityOf(result);
  return severity ? SEVERITY_COLORS[severity] : 'green';
}

function matches(item: InspectionItem, text: string) {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/^0+/, '');
  return (
    (digits !== '' && item.itemNumber.startsWith(digits)) ||
    (item.qrCode?.toLowerCase().includes(q) ?? false) ||
    JSON.stringify(item.fieldValues).toLowerCase().includes(q)
  );
}

/** Group label of a row: the location without its last level (e.g. "Hala A › Řada 1"). */
function groupOf(item: InspectionItem) {
  return item.locationPath.length > 1
    ? item.locationPath.slice(0, -1).join(LOCATION_SEPARATOR)
    : (item.locationPath[0] ?? 'Bez umístění');
}

function ItemRow({
  item,
  type,
  pending,
  onOpen,
}: {
  item: InspectionItem;
  type: EquipmentType | undefined;
  /** Changes of this item are still waiting on the device. */
  pending: boolean;
  onOpen: () => void;
}) {
  const position = item.locationPath.length > 1 ? item.locationPath.at(-1) : null;
  const manufacturer = item.fieldValues.manufacturer;
  return (
    <UnstyledButton onClick={onOpen} w="100%" data-testid={`item-${item.itemNumber}`}>
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Text ff="monospace" fw={700} fz={22} miw={110}>
              {item.itemNumber}
            </Text>
            <div>
              <Text fw={500}>{type?.name ?? '?'}</Text>
              <Text size="sm" c="dimmed">
                {[position, typeof manufacturer === 'string' ? manufacturer : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {pending && (
              <IconCloudUpload
                size={20}
                color="var(--mantine-color-orange-6)"
                aria-label="Čeká na odeslání"
              />
            )}
            {item.status === 'out_of_service' && !item.result?.takenOutOfService && (
              <Badge color="gray">Mimo provoz</Badge>
            )}
            {item.result ? (
              <Badge size="lg" color={resultColor(item.result)}>
                {outcomeLabel(item.result)}
              </Badge>
            ) : (
              <Badge size="lg" variant="outline" color="gray">
                Nezkontrolováno
              </Badge>
            )}
          </Group>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

function InspectionPhotos({ inspectionId, readOnly }: { inspectionId: string; readOnly: boolean }) {
  const photos = usePhotos({ inspectionId });
  const local = useLocalPhotos(usePendingPhotos({ owner: 'inspection', inspectionId }));
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const add = async () => {
    const file = await pickPhoto();
    if (!file) return;
    try {
      await upload.mutateAsync({
        id: newId(),
        file: await preparePhoto(file),
        owner: 'inspection',
        inspectionId,
        takenAt: new Date().toISOString(),
      });
    } catch (error) {
      notifyError(error);
    }
  };
  return (
    <PhotoStrip
      title="Celkové fotky kontroly"
      description="Hala, přístup, situace – nepatří k žádnému artiklu."
      photos={photos.data ?? []}
      local={local}
      busy={upload.isPending}
      disabled={readOnly}
      onAdd={() => void add()}
      onDeleteLocal={(p) => void cancelPhoto(p.id)}
      onDelete={(p: Photo) => {
        if (window.confirm('Smazat fotku?')) remove.mutate({ id: p.id }, { onError: notifyError });
      }}
    />
  );
}

/** The technician's working view of one inspection (field mode, M5). */
export function InspectionPage() {
  const { inspectionId } = useParams({ from: '/field/teren/kontrola/$inspectionId' });
  const navigate = useNavigate();
  const inspection = useInspection(inspectionId);
  const itemsQuery = useInspectionItems(inspectionId);
  const types = useEquipmentTypes(true);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const typeById = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t])), [types.data]);

  const [filter, setFilter] = useState<Filter>('unchecked');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [hallFilter, setHallFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ id: string; source: Source } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{ qrCode?: string } | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const outbox = useOutbox();
  const pendingItems = useMemo(() => new Set(outbox.map((c) => c.itemId)), [outbox]);
  const createItem = useCreateFieldItem(inspectionId);
  const readOnly = inspection.data?.status === 'closed';
  const progress = progressOf(items);
  const openItem = items.find((i) => i.id === open?.id) ?? null;

  const halls = useMemo(
    () => [...new Set(items.map((i) => i.locationPath[0]).filter((h): h is string => !!h))],
    [items],
  );
  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (filter === 'all' ||
            (filter === 'unchecked' ? !i.result : i.result?.outcome === 'defect')) &&
          (!typeFilter || i.equipmentTypeId === typeFilter) &&
          (!hallFilter || i.locationPath[0] === hallFilter) &&
          matches(i, search),
      ),
    [items, filter, typeFilter, hallFilter, search],
  );
  const groups = useMemo(() => {
    const map = new Map<string, InspectionItem[]>();
    for (const item of visible) map.set(groupOf(item), [...(map.get(groupOf(item)) ?? []), item]);
    return [...map];
  }, [visible]);

  /** A code from the camera, a Bluetooth scanner or the number pad. */
  const handleCode = (text: string, source: Source = 'scan'): boolean => {
    const target = parseScanPayload(text);
    const found = target ? findScannedItem(items, target) : null;
    if (found) {
      scanFeedback.success();
      setOpen({ id: found.id, source });
      return true;
    }
    scanFeedback.failure();
    return false;
  };
  const handleRef = useRef(handleCode);
  handleRef.current = handleCode;

  useEffect(
    () =>
      listenForHardwareScanner((text) => {
        if (!handleRef.current(text)) setUnknown(text);
      }),
    [],
  );

  const afterSave = () => {
    if (open?.source !== 'list') return setOpen(null);
    // Walking down the list: continue with the next unchecked item below this one.
    const index = visible.findIndex((i) => i.id === open.id);
    const next = visible.slice(index + 1).find((i) => !i.result && i.id !== open.id);
    setOpen(next ? { id: next.id, source: 'list' } : null);
  };

  if (inspection.isPending || itemsQuery.isPending) return <Loader m="xl" />;
  if (inspection.error) return <Alert color="red">{inspection.error.message}</Alert>;
  const data = inspection.data;

  return (
    <Stack maw={1100} mx="auto" gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" align="flex-start">
          <ButtonLink to="/teren" variant="subtle" px="xs" aria-label="Zpět na kontroly">
            <IconArrowLeft />
          </ButtonLink>
          <div>
            <Title order={2}>{data.siteName}</Title>
            <Text c="dimmed">
              {data.customerName} ·{' '}
              {data.equipmentTypeIds.length
                ? data.equipmentTypeIds.map((id) => typeById.get(id)?.name ?? '?').join(', ')
                : 'všechny typy'}
            </Text>
          </div>
        </Group>
        <Button
          variant="light"
          size="md"
          leftSection={<IconFlag size={18} />}
          onClick={() => setFinishing(true)}
        >
          Ukončit práci
        </Button>
      </Group>

      {readOnly && <Alert color="gray">Kontrola je uzavřená, výsledky jsou jen pro čtení.</Alert>}

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb={6}>
          <Text fw={700} size="lg" data-testid="progress">
            {progress.checked} / {progress.total} zkontrolováno
          </Text>
          <Group gap="xs">
            <Badge color="green">V pořádku {progress.ok}</Badge>
            <Badge color="orange">Závady {progress.defect - progress.outOfService}</Badge>
            <Badge color="red">Vyřazeno {progress.outOfService}</Badge>
          </Group>
        </Group>
        <Progress
          value={progress.total ? (progress.checked / progress.total) * 100 : 0}
          size="xl"
          radius="xl"
        />
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Button
          size="xl"
          leftSection={<IconQrcode />}
          onClick={() => {
            scanFeedback.unlock();
            setScanning(true);
          }}
        >
          Skenovat
        </Button>
        <Button
          size="xl"
          variant="light"
          leftSection={<IconDialpad />}
          onClick={() => {
            scanFeedback.unlock();
            setPadOpen(true);
          }}
        >
          Číslo
        </Button>
        <Button
          size="xl"
          variant="light"
          leftSection={<IconPlus />}
          disabled={readOnly}
          onClick={() => setNewItem({})}
        >
          Nový artikl
        </Button>
        <Button
          size="xl"
          variant="light"
          leftSection={<IconCamera />}
          onClick={() => setPhotosOpen(true)}
        >
          Fotky kontroly
        </Button>
      </SimpleGrid>

      <Group gap="sm" align="flex-end">
        <SegmentedControl
          size="md"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          data={[
            { value: 'unchecked', label: `Nezkontrolované (${progress.total - progress.checked})` },
            { value: 'defects', label: `Závady (${progress.defect})` },
            { value: 'all', label: `Vše (${progress.total})` },
          ]}
        />
        <Select
          size="md"
          placeholder="Všechny haly"
          aria-label="Hala"
          clearable
          data={halls}
          value={hallFilter}
          onChange={setHallFilter}
          w={170}
        />
        <Select
          size="md"
          placeholder="Všechny typy"
          aria-label="Typ vybavení"
          clearable
          data={[...new Set(items.map((i) => i.equipmentTypeId))].map((id) => ({
            value: id,
            label: typeById.get(id)?.name ?? '?',
          }))}
          value={typeFilter}
          onChange={setTypeFilter}
          w={200}
        />
        <TextInput
          size="md"
          placeholder="Hledat číslo, QR, výrobce…"
          aria-label="Hledat"
          leftSection={<IconSearch size={18} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </Group>

      {visible.length === 0 && (
        <Alert color={filter === 'unchecked' && items.length > 0 ? 'green' : 'gray'}>
          {filter === 'unchecked' && items.length > 0
            ? 'Vše zkontrolováno.'
            : 'Žádné artikly neodpovídají filtru.'}
        </Alert>
      )}
      <Stack gap="lg">
        {groups.map(([group, rows]) => (
          <Stack key={group} gap={6}>
            <Text fw={700} c="dimmed" tt="uppercase" size="sm">
              {group}
            </Text>
            {rows.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                type={typeById.get(item.equipmentTypeId)}
                pending={pendingItems.has(item.id)}
                onOpen={() => setOpen({ id: item.id, source: 'list' })}
              />
            ))}
          </Stack>
        ))}
      </Stack>

      {scanning && (
        <ScannerOverlay
          paused={open !== null || unknown !== null || newItem !== null}
          progressLabel={`${progress.checked} / ${progress.total}`}
          onCode={(text) => {
            if (!handleCode(text, 'scan')) setUnknown(text);
          }}
          onClose={() => setScanning(false)}
        />
      )}

      <ItemSheet
        inspectionId={inspectionId}
        item={openItem}
        type={openItem ? typeById.get(openItem.equipmentTypeId) : undefined}
        readOnly={readOnly}
        onClose={() => setOpen(null)}
        onSaved={afterSave}
      />

      <NumberPad
        opened={padOpen}
        onClose={() => setPadOpen(false)}
        onNumber={(digits, confirmed) => {
          const target = parseScanPayload(digits);
          const found = target ? findScannedItem(items, target) : null;
          if (!found) {
            if (confirmed) scanFeedback.failure();
            return false;
          }
          scanFeedback.success();
          setOpen({ id: found.id, source: 'scan' });
          return true;
        }}
      />

      <Modal
        opened={unknown !== null}
        onClose={() => setUnknown(null)}
        title="Neznámý kód"
        centered
        zIndex={300}
      >
        <Stack>
          <Text>
            Kód <b>{unknown}</b> nepatří žádnému artiklu této kontroly.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" size="md" onClick={() => setUnknown(null)}>
              Pokračovat
            </Button>
            {!readOnly && (
              <Button
                size="md"
                onClick={() => {
                  setNewItem({ qrCode: unknown ?? undefined });
                  setUnknown(null);
                }}
              >
                Založit artikl s tímto kódem
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>

      <Drawer
        opened={newItem !== null}
        onClose={() => setNewItem(null)}
        title="Nový artikl"
        position="right"
        size="min(720px, 100%)"
        zIndex={300}
      >
        {newItem && (
          <ItemForm
            item={null}
            fixedSite
            allowedTypeIds={data.equipmentTypeIds}
            defaults={{
              customerId: data.customerId,
              siteId: data.siteId,
              ...(data.equipmentTypeIds.length === 1
                ? { equipmentTypeId: data.equipmentTypeIds[0] }
                : {}),
              ...(newItem.qrCode ? { qrCode: newItem.qrCode } : {}),
            }}
            onCreate={async (body, locationPath) => {
              const number = body.itemNumber ? canonicalItemNumber(body.itemNumber) : null;
              const taken = number && items.find((i) => i.itemNumber === number);
              if (taken) throw new Error(`Číslo ${number} už má jiný artikl v této provozovně.`);
              const created = await createItem.mutateAsync({
                body,
                preview: {
                  id: body.id,
                  // Without a number the server assigns the next free one when it gets the item.
                  itemNumber: number ?? 'nový',
                  qrCode: body.qrCode || null,
                  equipmentTypeId: body.equipmentTypeId,
                  locationId: body.locationId ?? null,
                  locationPath,
                  fieldValues: body.fieldValues ?? {},
                  status: 'in_service',
                  nextInspectionDate: body.nextInspectionDate ?? null,
                  itemPhotoCount: 0,
                  result: null,
                },
              });
              notifySaved(`Artikl ${created.itemNumber} založen v zařízení`);
              // Record its result right away.
              setOpen({ id: created.id, source: 'scan' });
            }}
            onDone={() => setNewItem(null)}
          />
        )}
      </Drawer>

      <Drawer
        opened={photosOpen}
        onClose={() => setPhotosOpen(false)}
        title="Fotky kontroly"
        position="right"
        size="min(720px, 100%)"
      >
        <InspectionPhotos inspectionId={inspectionId} readOnly={readOnly} />
      </Drawer>

      <Modal opened={finishing} onClose={() => setFinishing(false)} title="Ukončit práci" centered>
        <Stack>
          <Text>
            {outbox.length === 0
              ? 'Všechny výsledky jsou odeslané na server.'
              : `V zařízení čeká na odeslání ${outbox.length} změn. Odešlou se samy, jakmile bude připojení – aplikaci můžete zavřít.`}{' '}
            Zkontrolováno {progress.checked} z {progress.total}
            {progress.total > progress.checked &&
              `, nezkontrolováno zbývá ${progress.total - progress.checked}`}
            .
          </Text>
          <Text size="sm" c="dimmed">
            Kontrola zůstává otevřená, takže v ní můžete vy i kolegové pokračovat. Uzavře ji
            kancelář.
          </Text>
          <Box>
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setFinishing(false)}>
                Zpět ke kontrole
              </Button>
              <Button size="md" onClick={() => void navigate({ to: '/teren' })}>
                Odejít
              </Button>
            </Group>
          </Box>
        </Stack>
      </Modal>
    </Stack>
  );
}
