import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  Pagination,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { ITEM_STATUS_LABELS, LOCATION_SEPARATOR, type Item, type ItemStatus } from '@revize/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  useBulkUpdateItems,
  useCustomers,
  useEquipmentTypes,
  useItems,
  useLocations,
  useMe,
  useSites,
} from '../api/hooks.js';
import { ItemForm } from '../components/ItemForm.js';
import { formatDate, locationLabel } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { itemsRoute, type ItemsSearch } from '../router.js';
import { DateField } from '../components/DateField.js';
import { DatabaseExportMenu } from '../components/DatabaseExportMenu.js';
import { ItemHistory } from '../components/ItemHistory.js';
import { PrevNext } from '../components/PrevNext.js';

const PAGE_SIZE = 100;

const SORT_OPTIONS = [
  { value: 'location', label: 'Podle umístění' },
  { value: 'itemNumber', label: 'Podle čísla' },
  { value: 'type', label: 'Podle typu' },
  { value: 'nextInspection', label: 'Podle příští kontroly' },
  { value: 'updated', label: 'Naposledy změněné' },
];

type BulkAction = 'move' | 'status' | 'nextInspection' | 'retire' | null;

function BulkDialog({
  action,
  ids,
  siteId,
  onDone,
}: {
  action: Exclude<BulkAction, null>;
  ids: string[];
  siteId: string | undefined;
  onDone: () => void;
}) {
  const bulk = useBulkUpdateItems();
  const locations = useLocations(siteId);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [status, setStatus] = useState<ItemStatus>('in_service');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const set =
      action === 'move'
        ? { locationId }
        : action === 'status'
          ? { status }
          : action === 'nextInspection'
            ? { nextInspectionDate: date || null }
            : { retired: true };
    bulk.mutate(
      { ids, set, ...(reason ? { reason } : {}) },
      {
        onSuccess: (r) => (notifySaved(`Upraveno ${r.updated} artiklů`), onDone()),
        onError: notifyError,
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <Text size="sm">Vybráno artiklů: {ids.length}</Text>
        {action === 'move' &&
          (siteId ? (
            <Select
              label="Nové umístění"
              searchable
              clearable
              placeholder="Bez umístění"
              data={(locations.data ?? []).map((l) => ({
                value: l.id,
                label: l.pathNames.join(LOCATION_SEPARATOR),
              }))}
              value={locationId}
              onChange={setLocationId}
            />
          ) : (
            <Text c="red" size="sm">
              Nejdřív vyfiltrujte jednu provozovnu.
            </Text>
          ))}
        {action === 'status' && (
          <>
            <Select
              label="Nový stav"
              data={Object.entries(ITEM_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              value={status}
              allowDeselect={false}
              onChange={(v) => setStatus((v as ItemStatus) ?? 'in_service')}
            />
            <TextInput
              label="Důvod"
              required
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
          </>
        )}
        {action === 'nextInspection' && (
          <DateField label="Datum příští kontroly" value={date} onChange={setDate} />
        )}
        {action === 'retire' && (
          <Text size="sm">
            Artikly se vyřadí z evidence – nebudou se kontrolovat, ale zůstanou v historii.
          </Text>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={bulk.isPending} disabled={action === 'move' && !siteId}>
            Provést
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ItemsPage() {
  const search = itemsRoute.useSearch();
  const navigate = useNavigate({ from: itemsRoute.fullPath });
  const me = useMe();
  const canWrite = !!me.data?.permissions.includes('item.write');
  const setSearch = (patch: Partial<ItemsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });

  const customers = useCustomers();
  const sites = useSites(search.customerId);
  const types = useEquipmentTypes();
  const locations = useLocations(search.siteId);
  const [text, setText] = useState(search.q ?? '');
  const [debounced] = useDebouncedValue(text, 300);
  useEffect(() => {
    if ((search.q ?? '') !== debounced) setSearch({ q: debounced || undefined });
  }, [debounced]);

  const page = search.page ?? 1;
  const items = useItems({
    customerId: search.customerId,
    siteId: search.siteId,
    equipmentTypeId: search.equipmentTypeId,
    locationId: search.locationId,
    status: search.status,
    due: search.due,
    lastInspection: search.lastInspection,
    incomplete: search.incomplete,
    q: search.q,
    sort: search.sort ?? 'location',
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [search]);
  const rows = items.data?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [editing, setEditing] = useState<Item | null>(null);
  const [drawerOpened, drawer] = useDisclosure();
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  // Every opening gets a fresh form, even while the previous drawer is still animating out.
  const [formSession, setFormSession] = useState(0);
  const openItem = (item: Item | null) => {
    setEditing(item);
    setFormSession((n) => n + 1);
    drawer.open();
  };

  const typeById = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t])), [types.data]);
  /** First text field of the type (usually the manufacturer) as an extra column. */
  const firstText = (item: Item) => {
    const field = typeById
      .get(item.equipmentTypeId)
      ?.fieldDefinitions.find((f) => f.kind === 'text' && !f.archived);
    return field ? String(item.fieldValues[field.key] ?? '') : '';
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Artikly</Title>
        <Group>
          <DatabaseExportMenu
            filters={{
              customerId: search.customerId,
              siteId: search.siteId,
              equipmentTypeId: search.equipmentTypeId,
              status: search.status,
              due: search.due,
              lastInspection: search.lastInspection,
              incomplete: search.incomplete ? 'true' : undefined,
            }}
          />
          {canWrite && <Button onClick={() => openItem(null)}>Nový artikl</Button>}
        </Group>
      </Group>

      <Paper withBorder p="sm">
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Zákazník"
            placeholder="Všichni"
            searchable
            clearable
            w={220}
            data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={search.customerId ?? null}
            onChange={(v) =>
              setSearch({ customerId: v ?? undefined, siteId: undefined, locationId: undefined })
            }
          />
          <Select
            label="Provozovna"
            placeholder="Všechny"
            clearable
            w={200}
            disabled={!search.customerId}
            data={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            value={search.siteId ?? null}
            onChange={(v) => setSearch({ siteId: v ?? undefined, locationId: undefined })}
          />
          <Select
            label="Umístění (včetně podřízených)"
            placeholder="Všechna"
            searchable
            clearable
            w={260}
            disabled={!search.siteId}
            data={(locations.data ?? []).map((l) => ({
              value: l.id,
              label: l.pathNames.join(LOCATION_SEPARATOR),
            }))}
            value={search.locationId ?? null}
            onChange={(v) => setSearch({ locationId: v ?? undefined })}
          />
          <Select
            label="Typ"
            placeholder="Všechny"
            clearable
            w={180}
            data={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            value={search.equipmentTypeId ?? null}
            onChange={(v) => setSearch({ equipmentTypeId: v ?? undefined })}
          />
          <Select
            label="Stav"
            placeholder="Všechny"
            clearable
            w={170}
            data={Object.entries(ITEM_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            value={search.status ?? null}
            onChange={(v) => setSearch({ status: (v as ItemStatus) ?? undefined })}
          />
          <Select
            label="Příští kontrola"
            placeholder="Kdykoli"
            clearable
            w={170}
            data={[
              { value: 'overdue', label: 'Po termínu' },
              { value: '30', label: 'Do 30 dní' },
              { value: '60', label: 'Do 60 dní' },
              { value: '90', label: 'Do 90 dní' },
            ]}
            value={search.due ?? null}
            onChange={(v) => setSearch({ due: (v as ItemsSearch['due']) ?? undefined })}
          />
          <Select
            label="Poslední kontrola"
            placeholder="Všechny"
            clearable
            w={230}
            data={[{ value: 'unchecked', label: 'Nezkontrolované v poslední kontrole' }]}
            value={search.lastInspection ?? null}
            onChange={(v) =>
              setSearch({ lastInspection: (v as ItemsSearch['lastInspection']) ?? undefined })
            }
          />
          <Switch
            label="Jen neúplné"
            mb={6}
            checked={search.incomplete === true}
            onChange={(e) => setSearch({ incomplete: e.currentTarget.checked || undefined })}
          />
          <TextInput
            label="Hledat"
            placeholder="Číslo TZ, označení, QR…"
            leftSection={<IconSearch size={16} />}
            w={220}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Select
            label="Řazení"
            w={200}
            data={SORT_OPTIONS}
            allowDeselect={false}
            value={search.sort ?? 'location'}
            onChange={(v) => setSearch({ sort: (v as ItemsSearch['sort']) ?? undefined })}
          />
        </Group>
      </Paper>

      {selected.size > 0 && canWrite && (
        <Paper withBorder p="xs" bg="blue.0">
          <Group>
            <Text size="sm" fw={600}>
              Vybráno: {selected.size}
            </Text>
            <Button size="xs" variant="default" onClick={() => setBulkAction('move')}>
              Přesunout…
            </Button>
            <Button size="xs" variant="default" onClick={() => setBulkAction('status')}>
              Změnit stav…
            </Button>
            <Button size="xs" variant="default" onClick={() => setBulkAction('nextInspection')}>
              Příští kontrola…
            </Button>
            <Button size="xs" variant="default" color="red" onClick={() => setBulkAction('retire')}>
              Vyřadit z evidence…
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setSelected(new Set())}>
              Zrušit výběr
            </Button>
          </Group>
        </Paper>
      )}

      <Text size="sm" c="dimmed">
        {items.data ? `Nalezeno ${items.data.total} artiklů` : 'Načítám…'}
      </Text>
      <Table striped highlightOnHover stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {canWrite && (
              <Table.Th w={36}>
                <Checkbox
                  aria-label="Vybrat vše"
                  checked={allSelected}
                  indeterminate={!allSelected && rows.some((r) => selected.has(r.id))}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                />
              </Table.Th>
            )}
            <Table.Th>Číslo TZ</Table.Th>
            <Table.Th>Označení</Table.Th>
            <Table.Th>Typ</Table.Th>
            <Table.Th>Umístění</Table.Th>
            <Table.Th>Výrobce / popis</Table.Th>
            <Table.Th>Stav</Table.Th>
            <Table.Th>Příští kontrola</Table.Th>
            <Table.Th>QR kód</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((item) => (
            <Table.Tr
              key={item.id}
              style={{ cursor: 'pointer' }}
              onClick={() => openItem(item)}
              data-testid="item-row"
            >
              {canWrite && (
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Vybrat ${item.itemNumber}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                </Table.Td>
              )}
              <Table.Td fw={700} ff="monospace">
                {item.itemNumber}
              </Table.Td>
              <Table.Td fw={600}>{item.designation ?? ''}</Table.Td>
              <Table.Td>{item.equipmentTypeName}</Table.Td>
              <Table.Td>{locationLabel(item.locationPath)}</Table.Td>
              <Table.Td>{firstText(item)}</Table.Td>
              <Table.Td>
                {item.status === 'out_of_service' ? (
                  <Badge color="red">vyřazen z provozu</Badge>
                ) : (
                  <Badge color="green" variant="light">
                    v provozu
                  </Badge>
                )}
                {item.missingFields.length > 0 && (
                  <Badge
                    color="yellow"
                    variant="light"
                    ml={4}
                    title={item.missingFields.join(', ')}
                  >
                    neúplný
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{formatDate(item.nextInspectionDate)}</Table.Td>
              <Table.Td ff="monospace">{item.qrCode ?? ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {items.data && items.data.total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(items.data.total / PAGE_SIZE)}
          value={page}
          onChange={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }) })}
        />
      )}

      <Drawer
        opened={drawerOpened}
        onClose={drawer.close}
        position="right"
        size="xl"
        title={
          editing ? (
            <Group gap="md" wrap="nowrap">
              <span>Artikl {editing.itemNumber}</span>
              <PrevNext
                index={rows.findIndex((r) => r.id === editing.id)}
                total={rows.length}
                onMove={(index) => openItem(rows[index]!)}
              />
            </Group>
          ) : (
            'Nový artikl'
          )
        }
      >
        <ItemForm
          key={`${editing?.id ?? 'new'}-${formSession}`}
          item={editing}
          defaults={{
            customerId: search.customerId,
            siteId: search.siteId,
            locationId: search.locationId,
            equipmentTypeId: search.equipmentTypeId,
          }}
          onDone={drawer.close}
        />
        {editing && (
          <ItemHistory
            itemId={editing.id}
            riskLevels={types.data?.find((t) => t.id === editing.equipmentTypeId)?.riskLevels}
          />
        )}
      </Drawer>
      <Modal
        opened={bulkAction !== null}
        onClose={() => setBulkAction(null)}
        title={
          bulkAction === 'move'
            ? 'Přesunout artikly'
            : bulkAction === 'status'
              ? 'Změnit stav'
              : bulkAction === 'nextInspection'
                ? 'Datum příští kontroly'
                : 'Vyřadit z evidence'
        }
      >
        {bulkAction && (
          <BulkDialog
            action={bulkAction}
            ids={[...selected]}
            siteId={search.siteId}
            onDone={() => {
              setBulkAction(null);
              setSelected(new Set());
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}
