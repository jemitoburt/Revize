import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconDots, IconPlus } from '@tabler/icons-react';
import { LOCATION_SEPARATOR, type Location } from '@revize/shared';
import { IntervalField } from './IntervalField.js';
import { useState, type FormEvent } from 'react';
import {
  useCreateLocation,
  useCreateLocationSeries,
  useLocations,
  useUpdateLocation,
} from '../api/hooks.js';
import { notifyError, notifySaved } from '../lib/notify.js';

type Dialog =
  | { kind: 'add'; parent: Location | null }
  | { kind: 'series'; parent: Location | null }
  | { kind: 'rename'; location: Location }
  | { kind: 'move'; location: Location }
  | null;

const pathOf = (l: Location) => l.pathNames.join(LOCATION_SEPARATOR);

function AddForm({
  siteId,
  parent,
  onDone,
}: {
  siteId: string;
  parent: Location | null;
  onDone: () => void;
}) {
  const create = useCreateLocation();
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { siteId, parentId: parent?.id ?? null, name },
      { onSuccess: () => (notifySaved(), onDone()), onError: notifyError },
    );
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <Text size="sm" c="dimmed">
          {parent ? `Pod: ${pathOf(parent)}` : 'Nejvyšší úroveň (např. hala, budova)'}
        </Text>
        <TextInput
          label="Název"
          placeholder="Např. Hala A, Řada 3"
          required
          data-autofocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending}>
            Přidat
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function SeriesForm({
  siteId,
  parent,
  onDone,
}: {
  siteId: string;
  parent: Location | null;
  onDone: () => void;
}) {
  const create = useCreateLocationSeries();
  const [prefix, setPrefix] = useState(parent ? 'Pozice' : 'Hala');
  const [from, setFrom] = useState<number>(1);
  const [to, setTo] = useState<number>(10);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { siteId, parentId: parent?.id ?? null, prefix, from, to },
      {
        onSuccess: (rows) => (notifySaved(`Přidáno ${rows.length} umístění`), onDone()),
        onError: notifyError,
      },
    );
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <Text size="sm" c="dimmed">
          {parent ? `Pod: ${pathOf(parent)}` : 'Nejvyšší úroveň'}
        </Text>
        <TextInput
          label="Název (předpona)"
          value={prefix}
          onChange={(e) => setPrefix(e.currentTarget.value)}
        />
        <Group grow>
          <NumberInput
            label="Od"
            min={0}
            max={9999}
            value={from}
            onChange={(v) => setFrom(Number(v) || 0)}
          />
          <NumberInput
            label="Do"
            min={0}
            max={9999}
            value={to}
            onChange={(v) => setTo(Number(v) || 0)}
          />
        </Group>
        <Text size="sm">
          Vznikne: {prefix} {from}, {prefix} {from + 1} … {prefix} {to} (
          {Math.max(0, to - from + 1)} umístění)
        </Text>
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending}>
            Přidat řadu
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function RenameForm({ location, onDone }: { location: Location; onDone: () => void }) {
  const update = useUpdateLocation();
  const [name, setName] = useState(location.name);
  const [interval, setInterval] = useState<number | null>(location.inspectionIntervalMonths);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { id: location.id, version: location.version, name, inspectionIntervalMonths: interval },
      { onSuccess: () => (notifySaved(), onDone()), onError: notifyError },
    );
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput
          label="Název"
          required
          data-autofocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <IntervalField
          value={interval}
          onChange={setInterval}
          inherited="z nadřazeného umístění, provozovny nebo typu vybavení (platí pro artikly v tomto umístění)"
        />
        <Group justify="flex-end">
          <Button type="submit" loading={update.isPending}>
            Uložit
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function MoveForm({
  location,
  all,
  onDone,
}: {
  location: Location;
  all: Location[];
  onDone: () => void;
}) {
  const update = useUpdateLocation();
  const [parentId, setParentId] = useState<string>(location.parentId ?? '');
  // Not under itself or its own descendants: in tree order these directly follow it with a
  // greater depth.
  const start = all.findIndex((l) => l.id === location.id);
  let end = start + 1;
  while (end < all.length && all[end]!.depth > location.depth) end++;
  const excluded = new Set(all.slice(start, end).map((l) => l.id));
  const options = [
    { value: '', label: '— nejvyšší úroveň —' },
    ...all.filter((l) => !excluded.has(l.id)).map((l) => ({ value: l.id, label: pathOf(l) })),
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { id: location.id, version: location.version, parentId: parentId || null },
      {
        onSuccess: () => (notifySaved('Přesunuto i s podřízenými umístěními'), onDone()),
        onError: notifyError,
      },
    );
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <Text size="sm">
          Přesunout „{pathOf(location)}“ včetně všech podřízených umístění a artiklů pod:
        </Text>
        <Select
          searchable
          data={options}
          value={parentId}
          allowDeselect={false}
          onChange={(v) => setParentId(v ?? '')}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={update.isPending}>
            Přesunout
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Location tree of a site: indented list in tree order with all editing actions. */
export function LocationTree({ siteId, canWrite }: { siteId: string; canWrite: boolean }) {
  const locations = useLocations(siteId);
  const update = useUpdateLocation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const all = locations.data ?? [];
  const close = () => setDialog(null);

  const siblings = (l: Location) => all.filter((x) => x.parentId === l.parentId);
  const swap = (l: Location, direction: -1 | 1) => {
    const list = siblings(l);
    const index = list.findIndex((x) => x.id === l.id);
    const other = list[index + direction];
    if (!other) return;
    // Swap sort orders (equal orders get distinct ones).
    const a = other.sortOrder === l.sortOrder ? l.sortOrder + direction : other.sortOrder;
    update.mutate(
      { id: l.id, version: l.version, sortOrder: a },
      {
        onSuccess: () =>
          update.mutate(
            { id: other.id, version: other.version, sortOrder: l.sortOrder },
            { onError: notifyError },
          ),
        onError: notifyError,
      },
    );
  };
  const archive = (l: Location) =>
    modals.openConfirmModal({
      title: 'Archivovat umístění?',
      children: (
        <Text size="sm">
          „{pathOf(l)}“ i všechna podřízená umístění zmizí ze seznamů. Jde to jen, pokud v nich
          nejsou artikly.
        </Text>
      ),
      onConfirm: () =>
        update.mutate(
          { id: l.id, version: l.version, archived: true },
          { onSuccess: () => notifySaved('Archivováno'), onError: notifyError },
        ),
    });

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Umístění ({all.length})</Text>
        {canWrite && (
          <Group gap="xs">
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setDialog({ kind: 'add', parent: null })}
            >
              Hlavní umístění
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => setDialog({ kind: 'series', parent: null })}
            >
              Řada hlavních umístění
            </Button>
          </Group>
        )}
      </Group>
      {all.length === 0 && locations.isSuccess && (
        <Text c="dimmed" size="sm">
          Zatím žádná umístění. Začněte halou nebo budovou, pod ni přidejte řady a pozice.
        </Text>
      )}
      <Stack gap={2} role="tree" aria-label="Umístění">
        {all.map((l) => (
          <Group
            key={l.id}
            role="treeitem"
            aria-level={l.depth + 1}
            justify="space-between"
            wrap="nowrap"
            pl={l.depth * 24}
            py={4}
            style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}
          >
            <Group gap="xs" wrap="nowrap">
              <Text fw={l.depth === 0 ? 700 : 400}>{l.name}</Text>
              {l.itemCount > 0 && (
                <Badge variant="light" size="sm">
                  {l.itemCount} art.
                </Badge>
              )}
            </Group>
            {canWrite && (
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Přidat podřízené">
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Přidat pod ${l.name}`}
                    onClick={() => setDialog({ kind: 'add', parent: l })}
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Posunout ${l.name} nahoru`}
                  onClick={() => swap(l, -1)}
                >
                  <IconArrowUp size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Posunout ${l.name} dolů`}
                  onClick={() => swap(l, 1)}
                >
                  <IconArrowDown size={16} />
                </ActionIcon>
                <Menu withinPortal position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" aria-label={`Akce pro ${l.name}`}>
                      <IconDots size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => setDialog({ kind: 'series', parent: l })}>
                      Přidat řadu podřízených…
                    </Menu.Item>
                    <Menu.Item onClick={() => setDialog({ kind: 'rename', location: l })}>
                      Upravit (název, interval)…
                    </Menu.Item>
                    <Menu.Item onClick={() => setDialog({ kind: 'move', location: l })}>
                      Přesunout…
                    </Menu.Item>
                    <Menu.Item color="red" onClick={() => archive(l)}>
                      Archivovat
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            )}
          </Group>
        ))}
      </Stack>

      <Modal
        opened={dialog !== null}
        onClose={close}
        title={
          dialog?.kind === 'add'
            ? 'Nové umístění'
            : dialog?.kind === 'series'
              ? 'Řada umístění'
              : dialog?.kind === 'rename'
                ? 'Upravit umístění'
                : 'Přesunout umístění'
        }
      >
        {dialog?.kind === 'add' && (
          <AddForm siteId={siteId} parent={dialog.parent} onDone={close} />
        )}
        {dialog?.kind === 'series' && (
          <SeriesForm siteId={siteId} parent={dialog.parent} onDone={close} />
        )}
        {dialog?.kind === 'rename' && <RenameForm location={dialog.location} onDone={close} />}
        {dialog?.kind === 'move' && (
          <MoveForm location={dialog.location} all={all} onDone={close} />
        )}
      </Modal>
    </Paper>
  );
}
