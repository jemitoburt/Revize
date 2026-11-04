import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  useCreateEquipmentType,
  useEquipmentTypePresets,
  useEquipmentTypes,
  useMe,
} from '../api/hooks.js';
import { MergeTypesDialog } from '../components/MergeTypesDialog.js';
import { notifyError, notifySaved } from '../lib/notify.js';

function NewTypeDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const presets = useEquipmentTypePresets();
  const create = useCreateEquipmentType();
  const [name, setName] = useState('');
  const handlers = {
    onSuccess: (t: { id: string }) => (notifySaved('Typ vytvořen'), onCreated(t.id)),
    onError: notifyError,
  };
  const submitEmpty = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, defaultIntervalMonths: 12, protocolTemplate: '', fieldDefinitions: [] },
      handlers,
    );
  };

  return (
    <Tabs defaultValue="library">
      <Tabs.List mb="md">
        <Tabs.Tab value="library">Z knihovny podle norem</Tabs.Tab>
        <Tabs.Tab value="empty">Prázdný typ</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="library">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {presets.data?.map((p) => (
            <Card key={p.key} withBorder>
              <Stack gap="xs" h="100%" justify="space-between">
                <div>
                  <Text fw={700}>{p.name}</Text>
                  <Text size="sm" c="dimmed">
                    {p.description}
                  </Text>
                  <Text size="xs" mt={4}>
                    {p.standards.join(', ')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {p.fieldCount} polí · interval {p.defaultIntervalMonths} měs.
                  </Text>
                </div>
                <Button
                  size="xs"
                  loading={create.isPending}
                  onClick={() => create.mutate({ presetKey: p.key }, handlers)}
                >
                  Přidat
                </Button>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </Tabs.Panel>
      <Tabs.Panel value="empty">
        <form onSubmit={submitEmpty}>
          <Stack>
            <TextInput
              label="Název typu"
              required
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button type="submit" loading={create.isPending}>
                Vytvořit
              </Button>
            </Group>
          </Stack>
        </form>
      </Tabs.Panel>
    </Tabs>
  );
}

export function EquipmentTypesPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const types = useEquipmentTypes(includeArchived);
  const me = useMe();
  const canWrite = me.data?.permissions.includes('equipmentType.write');
  const navigate = useNavigate();
  const [opened, { open, close }] = useDisclosure();
  const [merging, merge] = useDisclosure();
  const openType = (id: string) => void navigate({ to: '/typy/$typeId', params: { typeId: id } });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Typy vybavení</Title>
        {canWrite && (
          <Group>
            <Button variant="default" onClick={merge.open}>
              Sloučit typy…
            </Button>
            <Button onClick={open}>Nový typ</Button>
          </Group>
        )}
      </Group>
      <Switch
        label="Zobrazit archivované"
        checked={includeArchived}
        onChange={(e) => setIncludeArchived(e.currentTarget.checked)}
      />
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Název</Table.Th>
            <Table.Th ta="right">Polí</Table.Th>
            <Table.Th ta="right">Interval kontrol</Table.Th>
            <Table.Th ta="right">Artiklů</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {types.data?.map((t) => (
            <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openType(t.id)}>
              <Table.Td fw={600}>
                {t.name} {t.archived && <Badge color="gray">archivován</Badge>}
              </Table.Td>
              <Table.Td ta="right">{t.fieldDefinitions.filter((f) => !f.archived).length}</Table.Td>
              <Table.Td ta="right">{t.defaultIntervalMonths} měs.</Table.Td>
              <Table.Td ta="right">{t.itemCount}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={merging} onClose={merge.close} title="Sloučit typy vybavení" size="lg">
        <MergeTypesDialog
          types={types.data ?? []}
          onDone={(id) => {
            merge.close();
            openType(id);
          }}
        />
      </Modal>
      <Modal opened={opened} onClose={close} title="Nový typ vybavení" size="xl">
        <NewTypeDialog
          onCreated={(id) => {
            close();
            openType(id);
          }}
        />
      </Modal>
    </Stack>
  );
}
