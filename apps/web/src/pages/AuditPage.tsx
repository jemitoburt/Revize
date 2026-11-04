import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  AUDIT_AREAS,
  auditActionLabel,
  auditChanges,
  auditEntityLabel,
  type AuditEntry,
} from '@revize/shared';
import { useState } from 'react';
import { useAudit, useUsers } from '../api/hooks.js';
import { DateField } from '../components/DateField.js';
import { formatDateTime } from '../lib/format.js';

function Changes({ entry }: { entry: AuditEntry }) {
  const changes = auditChanges(entry);
  if (!changes.length) return entry.reason ? <Text size="sm">{entry.reason}</Text> : null;
  return (
    <Stack gap={0}>
      {changes.slice(0, 6).map((c) => (
        <Text key={c.field} size="sm">
          <Text span fw={600}>
            {c.field}:
          </Text>{' '}
          {c.from} → {c.to}
        </Text>
      ))}
      {changes.length > 6 && (
        <Text size="xs" c="dimmed">
          … a {changes.length - 6} dalších
        </Text>
      )}
      {entry.reason && (
        <Text size="xs" c="dimmed">
          Důvod: {entry.reason}
        </Text>
      )}
    </Stack>
  );
}

/** Historie změn: the audit log for the office (who changed what and when). */
export function AuditPage() {
  const [area, setArea] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const users = useUsers();
  const audit = useAudit({
    entityType: area ?? undefined,
    actorId: actorId ?? undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const entries = audit.data?.pages.flat() ?? [];

  return (
    <Stack>
      <Title order={2}>Historie změn</Title>
      <Text c="dimmed">
        Kdo, kdy a co změnil: artikly, výsledky kontrol, fotky, typy vybavení, uživatelé i
        přihlášení. Záznamy se nedají upravit ani smazat.
      </Text>
      <Paper withBorder p="sm">
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Oblast"
            placeholder="Vše"
            clearable
            w={220}
            data={AUDIT_AREAS}
            value={area}
            onChange={setArea}
          />
          <Select
            label="Uživatel"
            placeholder="Všichni"
            clearable
            searchable
            w={220}
            data={(users.data ?? []).map((u) => ({ value: u.id, label: u.displayName }))}
            value={actorId}
            onChange={setActorId}
          />
          <DateField label="Od" w={150} value={from} onChange={setFrom} />
          <DateField label="Do" w={150} value={to} onChange={setTo} />
        </Group>
      </Paper>
      {audit.isPending && <Loader />}
      {audit.error && <Alert color="red">{audit.error.message}</Alert>}
      {audit.data && entries.length === 0 && <Text c="dimmed">Žádné záznamy.</Text>}
      {entries.length > 0 && (
        <Table data-testid="audit" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kdy</Table.Th>
              <Table.Th>Kdo</Table.Th>
              <Table.Th>Akce</Table.Th>
              <Table.Th>Čeho se týká</Table.Th>
              <Table.Th>Změny</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.createdAt)}</Table.Td>
                <Table.Td>{e.actor?.displayName ?? 'systém'}</Table.Td>
                <Table.Td>{auditActionLabel(e.action)}</Table.Td>
                <Table.Td>{auditEntityLabel(e)}</Table.Td>
                <Table.Td>
                  <Changes entry={e} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {audit.hasNextPage && (
        <Group justify="center">
          <Button
            variant="default"
            loading={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Načíst starší
          </Button>
        </Group>
      )}
    </Stack>
  );
}
