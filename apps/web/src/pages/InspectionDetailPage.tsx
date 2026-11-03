import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  LOCATION_SEPARATOR,
  addMonths,
  outcomeLabel,
  severityOf,
  type InspectionResult,
} from '@revize/shared';
import { IconFileText, IconLock, IconLockOpen } from '@tabler/icons-react';
import { useParams } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';
import {
  useCloseInspection,
  useEquipmentTypes,
  useInspection,
  useInspectionItems,
  useMe,
  useReopenInspection,
} from '../api/hooks.js';
import { ExportMenu } from '../components/ExportMenu.js';
import { AnchorLink, ButtonLink } from '../components/links.js';
import { ProtocolPreview } from '../components/ProtocolPreview.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { DateField } from '../components/DateField.js';

type Filter = 'all' | 'defects' | 'unchecked';

const SEVERITY_COLOR = { green: 'teal', amber: 'yellow', red: 'red' } as const;
const color = (r: InspectionResult) => {
  const severity = severityOf(r);
  return severity ? SEVERITY_COLOR[severity] : 'green';
};

function CloseForm({
  inspectionId,
  unchecked,
  defaultNext,
  onDone,
}: {
  inspectionId: string;
  unchecked: number;
  /** Inspection date + the shortest interval of the types in the inspection. */
  defaultNext: string;
  onDone: () => void;
}) {
  const close = useCloseInspection();
  const [date, setDate] = useState(defaultNext);
  const [note, setNote] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    close.mutate(
      { id: inspectionId, nextInspectionDate: date || null, note },
      {
        onSuccess: () => {
          notifySaved('Kontrola uzavřena');
          onDone();
        },
        onError: notifyError,
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {unchecked > 0 && (
          <Alert color="orange">
            {unchecked} artiklů zůstalo nezkontrolovaných. V protokolu budou uvedené jako
            nezkontrolované a jejich datum příští kontroly se nezmění.
          </Alert>
        )}
        <Text size="sm">
          Po uzavření nejde výsledky měnit. Zkontrolované artikly dostanou datum příští kontroly.
        </Text>
        <DateField
          label="Příští kontrola"
          description="Předvyplněno podle intervalu typů vybavení (datum kontroly + obvykle 12 měsíců). Vymazáním se použije interval každého typu zvlášť."
          value={date}
          onChange={setDate}
        />
        <Textarea
          label="Poznámka do protokolu"
          autosize
          minRows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={close.isPending} leftSection={<IconLock size={18} />}>
            Uzavřít kontrolu
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function ReopenForm({ inspectionId, onDone }: { inspectionId: string; onDone: () => void }) {
  const reopen = useReopenInspection();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) return setError('Uveďte důvod znovuotevření');
    reopen.mutate(
      { id: inspectionId, reason },
      {
        onSuccess: () => {
          notifySaved('Kontrola je znovu otevřená');
          onDone();
        },
        onError: (e) => setError(e.fieldErrors().reason ?? e.message),
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Text size="sm">
          Znovuotevření se zapíše do auditu. Data příští kontroly artiklů zůstávají, přepočítají se
          při dalším uzavření.
        </Text>
        <Textarea
          label="Důvod"
          required
          autosize
          minRows={2}
          data-autofocus
          value={reason}
          error={error}
          onChange={(e) => {
            setReason(e.currentTarget.value);
            setError(null);
          }}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={reopen.isPending} leftSection={<IconLockOpen size={18} />}>
            Znovu otevřít
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function InspectionDetailPage() {
  const { inspectionId } = useParams({ from: '/app/kontroly/$inspectionId' });
  const inspection = useInspection(inspectionId);
  const items = useInspectionItems(inspectionId);
  const types = useEquipmentTypes(true);
  const me = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<'close' | 'reopen' | 'protocol' | null>(null);
  const can = (p: string) => me.data?.permissions.includes(p as never) ?? false;
  const typeName = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.id, t.name])),
    [types.data],
  );

  if (inspection.isPending || items.isPending) return <Loader />;
  if (inspection.error) return <Alert color="red">{inspection.error.message}</Alert>;
  const data = inspection.data;
  const rows = (items.data ?? []).filter((i) =>
    filter === 'all' ? true : filter === 'defects' ? i.result?.outcome === 'defect' : !i.result,
  );
  const p = data.progress;
  const open = data.status === 'open';
  const usedTypes = new Set((items.data ?? []).map((i) => i.equipmentTypeId));
  const interval = Math.min(
    ...(types.data ?? []).filter((t) => usedTypes.has(t.id)).map((t) => t.defaultIntervalMonths),
  );
  const defaultNext = addMonths(data.inspectionDate, Number.isFinite(interval) ? interval : 12);

  return (
    <Stack>
      <AnchorLink to="/kontroly" size="sm">
        ← Kontroly
      </AnchorLink>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="sm">
            <Title order={2}>{data.siteName}</Title>
            <Badge color={open ? 'blue' : 'gray'} size="lg">
              {open ? 'Otevřená' : 'Uzavřená'}
            </Badge>
          </Group>
          <Text c="dimmed">
            {data.customerName} · {formatDate(data.inspectionDate)} ·{' '}
            {data.inspectors.map((i) => i.displayName).join(', ')}
          </Text>
        </div>
        <Group>
          <Button
            variant="light"
            leftSection={<IconFileText size={18} />}
            onClick={() => setDialog('protocol')}
          >
            Protokol
          </Button>
          <ExportMenu inspection={data} />
          {open && can('inspection.perform') && (
            <ButtonLink
              variant="default"
              to="/teren/kontrola/$inspectionId"
              params={{ inspectionId }}
            >
              Otevřít v terénu
            </ButtonLink>
          )}
          {open && can('inspection.close') && (
            <Button leftSection={<IconLock size={18} />} onClick={() => setDialog('close')}>
              Uzavřít kontrolu
            </Button>
          )}
          {!open && can('inspection.reopen') && (
            <Button
              variant="default"
              leftSection={<IconLockOpen size={18} />}
              onClick={() => setDialog('reopen')}
            >
              Znovu otevřít
            </Button>
          )}
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        {[
          ['Zkontrolováno', `${p.checked} / ${p.total}`],
          ['V pořádku', p.ok],
          ['Se závadou', p.defect - p.outOfService],
          ['Vyřazeno z provozu', p.outOfService],
          ['Příští kontrola', formatDate(data.nextInspectionDate)],
        ].map(([label, value]) => (
          <Paper key={label} withBorder p="sm">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="lg">
              {value}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      {data.note && <Alert color="gray">{data.note}</Alert>}

      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        data={[
          { value: 'all', label: `Vše (${p.total})` },
          { value: 'defects', label: `Závady (${p.defect})` },
          { value: 'unchecked', label: `Nezkontrolované (${p.total - p.checked})` },
        ]}
      />
      <Table data-testid="inspection-results">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Číslo TZ</Table.Th>
            <Table.Th>Označení</Table.Th>
            <Table.Th>Typ</Table.Th>
            <Table.Th>Umístění</Table.Th>
            <Table.Th>Výsledek</Table.Th>
            <Table.Th>Závada</Table.Th>
            <Table.Th>Zapsal</Table.Th>
            <Table.Th>Fotky</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((i) => (
            <Table.Tr key={i.id}>
              <Table.Td ff="monospace" fw={700}>
                {i.itemNumber}
              </Table.Td>
              <Table.Td fw={600}>{i.designation ?? ''}</Table.Td>
              <Table.Td>{typeName.get(i.equipmentTypeId)}</Table.Td>
              <Table.Td>{i.locationPath.join(LOCATION_SEPARATOR) || '–'}</Table.Td>
              <Table.Td>
                {i.result ? (
                  <Badge color={color(i.result)}>{outcomeLabel(i.result)}</Badge>
                ) : (
                  <Text size="sm" c="dimmed">
                    Nezkontrolováno
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {i.result?.defectDescription}
                {i.result && !i.result.includeInProtocol && (
                  <Text size="xs" c="dimmed">
                    Není v protokolu
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {i.result && (
                  <Text size="sm">
                    {i.result.recordedByName}
                    <br />
                    <Text span size="xs" c="dimmed">
                      {formatDateTime(i.result.recordedAt)}
                    </Text>
                  </Text>
                )}
              </Table.Td>
              <Table.Td>{(i.result?.photoCount ?? 0) + i.itemPhotoCount || ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={dialog === 'close'} onClose={() => setDialog(null)} title="Uzavřít kontrolu">
        <CloseForm
          inspectionId={inspectionId}
          unchecked={p.total - p.checked}
          defaultNext={defaultNext}
          onDone={() => setDialog(null)}
        />
      </Modal>
      <Modal
        opened={dialog === 'reopen'}
        onClose={() => setDialog(null)}
        title="Znovu otevřít kontrolu"
      >
        <ReopenForm inspectionId={inspectionId} onDone={() => setDialog(null)} />
      </Modal>
      <ProtocolPreview
        inspectionId={inspectionId}
        fileName={`protokol-${data.inspectionDate}.pdf`}
        types={[...new Set((items.data ?? []).map((i) => i.equipmentTypeId))].map((id) => ({
          id,
          name: typeName.get(id) ?? '?',
        }))}
        opened={dialog === 'protocol'}
        onClose={() => setDialog(null)}
      />
    </Stack>
  );
}
