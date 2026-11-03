import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  IconCloudCheck,
  IconCloudOff,
  IconCloudUpload,
  IconDownload,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useOutbox } from '../api/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { notifyError } from '../lib/notify.js';
import {
  exportUnsent,
  getSyncState,
  onCommandSent,
  retryCommand,
  startSync,
  stopSync,
  subscribeSync,
  syncAllNow,
} from '../offline/outbox.js';
import { requestPersistentStorage } from '../platform/local-db.js';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Runs the outbox for the signed-in user and refreshes cached lists after each sent change. */
export function useFieldSync(userId: string) {
  const client = useQueryClient();
  useEffect(() => {
    void requestPersistentStorage();
    startSync(userId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onCommandSent(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const key of ['inspection-items', 'inspections', 'photos', 'items']) {
          void client.invalidateQueries({ queryKey: [key] });
        }
      }, 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      stopSync();
    };
  }, [userId, client]);
}

async function download() {
  const blob = await exportUnsent();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `revize-neodeslano-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Header badge: connection and unsent field data; opens the list of unsent changes. */
export function SyncStatus({ userId }: { userId: string }) {
  const online = useOnline();
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const outbox = useOutbox();
  const [open, setOpen] = useState(false);
  const mine = outbox.filter((c) => c.userId === userId);
  const attention = mine.filter((c) => c.status === 'attention').length;
  const foreign = outbox.length - mine.length;

  const [color, icon, label] =
    attention > 0
      ? ([
          'red',
          <IconAlertTriangle key="i" size={16} />,
          `Vyžaduje pozornost: ${attention}`,
        ] as const)
      : mine.length > 0
        ? (['orange', <IconCloudUpload key="i" size={16} />, `Neodesláno: ${mine.length}`] as const)
        : online
          ? (['green', <IconCloudCheck key="i" size={16} />, 'Vše odesláno'] as const)
          : (['gray', <IconCloudOff key="i" size={16} />, 'Offline'] as const);

  return (
    <>
      <UnstyledButton onClick={() => setOpen(true)} aria-label="Stav odesílání">
        <Badge size="lg" color={color} variant="light" leftSection={icon} data-testid="sync-status">
          {label}
        </Badge>
      </UnstyledButton>
      <Drawer
        opened={open}
        onClose={() => setOpen(false)}
        title="Data v zařízení"
        position="right"
        size="min(640px, 100%)"
        zIndex={350}
      >
        <Stack>
          <Group gap="xs">
            <Badge color={online ? 'green' : 'gray'}>{online ? 'Online' : 'Bez připojení'}</Badge>
            {sync.sending && <Badge color="blue">Odesílám…</Badge>}
          </Group>
          {sync.needsLogin && (
            <Alert color="orange">
              Přihlášení vypršelo. Data zůstávají v zařízení a odešlou se po novém přihlášení.
            </Alert>
          )}
          <Text size="sm" c="dimmed">
            Každý výsledek a fotka se nejdřív uloží do tohoto zařízení a pak se odešlou na server,
            jakmile je připojení. Nic se nemaže, dokud to server nepřijme.
          </Text>
          {foreign > 0 && (
            <Alert color="gray">
              {foreign} změn zapsal jiný uživatel tohoto zařízení. Odešlou se po jeho přihlášení.
            </Alert>
          )}
          {mine.length === 0 ? (
            <Alert color="green">Všechno je odeslané na server.</Alert>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Změna</Table.Th>
                  <Table.Th>Zapsáno</Table.Th>
                  <Table.Th>Stav</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mine.map((c) => (
                  <Table.Tr key={c.seq}>
                    <Table.Td>{c.label}</Table.Td>
                    <Table.Td>{formatDateTime(c.createdAt)}</Table.Td>
                    <Table.Td>
                      {c.status === 'attention' ? (
                        <Stack gap={4}>
                          <Text size="sm" c="red">
                            {c.lastError}
                          </Text>
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => void retryCommand(c.seq!)}
                          >
                            Zkusit znovu
                          </Button>
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">
                          {c.attempts > 0 ? `Čeká (pokusů ${c.attempts})` : 'Čeká na odeslání'}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Group justify="space-between">
            <Button
              variant="default"
              leftSection={<IconDownload size={18} />}
              disabled={outbox.length === 0}
              onClick={() => void download().catch(notifyError)}
            >
              Stáhnout neodeslaná data
            </Button>
            <Button disabled={mine.length === 0} onClick={() => void syncAllNow()}>
              Odeslat nyní
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
