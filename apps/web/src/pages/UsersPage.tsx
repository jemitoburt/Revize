import {
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { CertificationFields } from '../components/CertificationFields.js';
import { ROLES, ROLE_LABELS, type Role, type User } from '@revize/shared';
import { useState, type FormEvent } from 'react';
import type { ApiRequestError } from '../api/client.js';
import { useCreateUser, useDeleteUser, useMe, useUpdateUser, useUsers } from '../api/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function UserForm({ user, onDone }: { user: User | null; onDone: () => void }) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const me = useMe();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'inspector');
  const [active, setActive] = useState(user?.active ?? true);
  const [certification, setCertification] = useState(user?.certification ?? '');
  const [certifications, setCertifications] = useState(user?.certifications ?? {});
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onError = (error: ApiRequestError) => {
    setErrors(error.fieldErrors());
    notifyError(error);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const done = { onSuccess: () => (notifySaved(), onDone()), onError };
    if (user) {
      update.mutate(
        {
          id: user.id,
          version: user.version,
          displayName,
          role,
          active,
          certification,
          certifications,
          ...(password ? { password } : {}),
        },
        done,
      );
    } else {
      create.mutate({ email, displayName, role, password, certification, certifications }, done);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput
          label="E-mail"
          type="email"
          required
          disabled={!!user}
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <TextInput
          label="Jméno"
          required
          value={displayName}
          error={errors.displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
        />
        <CertificationFields
          general={certification}
          perType={certifications}
          onGeneral={setCertification}
          onPerType={setCertifications}
          error={errors.certification}
        />
        <Select
          label="Role"
          data={roleOptions}
          value={role}
          allowDeselect={false}
          onChange={(v) => setRole((v as Role) ?? 'inspector')}
        />
        {user && (
          <Switch
            label="Aktivní (může se přihlásit)"
            checked={active}
            onChange={(e) => setActive(e.currentTarget.checked)}
          />
        )}
        <PasswordInput
          label={user ? 'Nové heslo (nepovinné, odhlásí uživatele)' : 'Heslo'}
          required={!user}
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {user && user.id !== me.data?.id && confirmDelete && (
          <Stack gap="xs" p="sm" style={{ border: '1px solid var(--mantine-color-red-4)' }}>
            <Text size="sm">
              Smazat uživatele {user.displayName}? Nebude se moct přihlásit a zmizí ze seznamu. Jeho
              jméno zůstane u provedených kontrol a v auditu. E-mail půjde použít znovu.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmDelete(false)}>
                Nemazat
              </Button>
              <Button
                color="red"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(user.id, {
                    onSuccess: () => (notifySaved('Uživatel smazán'), onDone()),
                    onError,
                  })
                }
              >
                Smazat
              </Button>
            </Group>
          </Stack>
        )}
        <Group justify="flex-end">
          {user && user.id !== me.data?.id && !confirmDelete && (
            <Button variant="subtle" color="red" mr="auto" onClick={() => setConfirmDelete(true)}>
              Smazat uživatele
            </Button>
          )}
          <Button type="submit" loading={create.isPending || update.isPending}>
            Uložit
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function UsersPage() {
  const users = useUsers();
  const [editing, setEditing] = useState<User | null>(null);
  const [opened, { open, close }] = useDisclosure();
  const openFor = (user: User | null) => {
    setEditing(user);
    open();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Uživatelé</Title>
        <Button onClick={() => openFor(null)}>Nový uživatel</Button>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Jméno</Table.Th>
            <Table.Th>E-mail</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Stav</Table.Th>
            <Table.Th>Poslední přihlášení</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.map((user) => (
            <Table.Tr key={user.id} onClick={() => openFor(user)} style={{ cursor: 'pointer' }}>
              <Table.Td>{user.displayName}</Table.Td>
              <Table.Td>{user.email}</Table.Td>
              <Table.Td>{ROLE_LABELS[user.role]}</Table.Td>
              <Table.Td>
                {user.active ? (
                  <Badge color="green">aktivní</Badge>
                ) : (
                  <Badge color="gray">neaktivní</Badge>
                )}
              </Table.Td>
              <Table.Td>{formatDateTime(user.lastLoginAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal
        opened={opened}
        onClose={close}
        title={editing ? 'Upravit uživatele' : 'Nový uživatel'}
      >
        <UserForm key={editing?.id ?? 'new'} user={editing} onDone={close} />
      </Modal>
    </Stack>
  );
}
