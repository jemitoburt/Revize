import {
  Badge,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { InspectionStatus } from '@revize/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useInspections } from '../api/hooks.js';
import { formatDate } from '../lib/format.js';

type Filter = InspectionStatus | 'all';

/** Office overview of inspections: open ones to close, closed ones with their protocol. */
export function InspectionsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const inspections = useInspections(filter === 'all' ? {} : { status: filter });
  const navigate = useNavigate();

  return (
    <Stack>
      <Title order={2}>Kontroly</Title>
      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        data={[
          { value: 'open', label: 'Otevřené' },
          { value: 'closed', label: 'Uzavřené' },
          { value: 'all', label: 'Všechny' },
        ]}
      />
      {inspections.isPending && <Loader />}
      {inspections.data?.length === 0 && <Text c="dimmed">Žádné kontroly.</Text>}
      {!!inspections.data?.length && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Datum</Table.Th>
              <Table.Th>Zákazník / provozovna</Table.Th>
              <Table.Th>Technici</Table.Th>
              <Table.Th w={220}>Zkontrolováno</Table.Th>
              <Table.Th>Závady</Table.Th>
              <Table.Th>Stav</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {inspections.data?.map((i) => (
              <Table.Tr
                key={i.id}
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  void navigate({ to: '/kontroly/$inspectionId', params: { inspectionId: i.id } })
                }
              >
                <Table.Td>{formatDate(i.inspectionDate)}</Table.Td>
                <Table.Td>
                  <Text fw={600}>{i.customerName}</Text>
                  <Text size="sm" c="dimmed">
                    {i.siteName}
                  </Text>
                </Table.Td>
                <Table.Td>{i.inspectors.map((x) => x.displayName).join(', ')}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Progress
                      value={i.progress.total ? (i.progress.checked / i.progress.total) * 100 : 0}
                      w={110}
                    />
                    <Text size="sm">
                      {i.progress.checked} / {i.progress.total}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {i.progress.defect > 0 ? (
                    <Badge color="orange">{i.progress.defect}</Badge>
                  ) : (
                    <Text c="dimmed">–</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge color={i.status === 'open' ? 'blue' : 'gray'}>
                    {i.status === 'open' ? 'Otevřená' : 'Uzavřená'}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
