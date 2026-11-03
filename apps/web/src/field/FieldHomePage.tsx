import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { newId, type Inspection } from '@revize/shared';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  useCustomers,
  useEquipmentTypes,
  useInspections,
  useSites,
  useStartInspection,
} from '../api/hooks.js';
import { ButtonLink } from '../components/links.js';
import { formatDate } from '../lib/format.js';
import { notifyError } from '../lib/notify.js';

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function InspectionCard({ inspection }: { inspection: Inspection }) {
  const { progress } = inspection;
  const percent = progress.total ? (progress.checked / progress.total) * 100 : 0;
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700} size="lg">
              {inspection.siteName}
            </Text>
            <Text c="dimmed">{inspection.customerName}</Text>
          </div>
          <Badge variant="light">{formatDate(inspection.inspectionDate)}</Badge>
        </Group>
        <Progress value={percent} size="lg" radius="xl" />
        <Group gap="md">
          <Text fw={600}>
            {progress.checked} / {progress.total} zkontrolováno
          </Text>
          {progress.defect > 0 && <Badge color="orange">Závady: {progress.defect}</Badge>}
        </Group>
        <Text size="sm" c="dimmed">
          {inspection.inspectors.map((i) => i.displayName).join(', ')}
        </Text>
        <ButtonLink
          to="/teren/kontrola/$inspectionId"
          params={{ inspectionId: inspection.id }}
          size="lg"
          mt="xs"
        >
          Pokračovat
        </ButtonLink>
      </Stack>
    </Card>
  );
}

function StartInspectionForm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const start = useStartInspection();
  const customers = useCustomers();
  const types = useEquipmentTypes();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const sites = useSites(customerId);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [id] = useState(newId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!siteId) next.siteId = 'Vyberte provozovnu';
    if (!date) next.inspectionDate = 'Zadejte datum';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    start.mutate(
      { id, siteId: siteId!, inspectionDate: date, equipmentTypeIds: typeIds, note },
      {
        onSuccess: () =>
          void navigate({ to: '/teren/kontrola/$inspectionId', params: { inspectionId: id } }),
        onError: (error) => {
          setErrors(error.fieldErrors());
          notifyError(error);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Select
          label="Zákazník"
          size="md"
          searchable
          data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={customerId}
          onChange={(v) => {
            setCustomerId(v);
            setSiteId(null);
          }}
        />
        <Select
          label="Provozovna"
          size="md"
          required
          data={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={siteId}
          error={errors.siteId}
          onChange={setSiteId}
        />
        <MultiSelect
          label="Typy vybavení"
          description="Nic nevybráno = všechny typy v provozovně"
          size="md"
          data={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          value={typeIds}
          onChange={setTypeIds}
          placeholder={typeIds.length ? undefined : 'Všechny typy'}
        />
        <TextInput
          label="Datum kontroly"
          type="date"
          size="md"
          required
          value={date}
          error={errors.inspectionDate}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <Textarea
          label="Poznámka"
          autosize
          minRows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" size="md" onClick={onClose}>
            Zrušit
          </Button>
          <Button type="submit" size="md" loading={start.isPending}>
            Zahájit
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Field mode home: open inspections to continue, or start a new one. */
export function FieldHomePage() {
  const open = useInspections({ status: 'open' });
  const [starting, setStarting] = useState(false);

  return (
    <Stack maw={1100} mx="auto">
      <Group justify="space-between">
        <Title order={1}>Kontroly v terénu</Title>
        <Button size="lg" leftSection={<IconPlayerPlay />} onClick={() => setStarting(true)}>
          Zahájit kontrolu
        </Button>
      </Group>
      {open.isPending && <Loader />}
      {open.error && <Alert color="red">{open.error.message}</Alert>}
      {open.data?.length === 0 && (
        <Alert color="gray">Žádná rozpracovaná kontrola. Zahajte novou.</Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {open.data?.map((i) => (
          <InspectionCard key={i.id} inspection={i} />
        ))}
      </SimpleGrid>
      <Modal
        opened={starting}
        onClose={() => setStarting(false)}
        title="Nová kontrola"
        size="lg"
        centered
      >
        <StartInspectionForm onClose={() => setStarting(false)} />
      </Modal>
    </Stack>
  );
}
