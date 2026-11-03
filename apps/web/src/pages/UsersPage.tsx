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
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ROLES, ROLE_LABELS, type Role, type User } from '@revize/shared';
import { useState, type FormEvent } from 'react';
import type { ApiRequestError } from '../api/client.js';
import { useCreateUser, useUpdateUser, useUsers } from '../api/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function UserForm({ user, onDone }: { user: User | null; onDone: () => void }) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'inspector');
  const [active, setActive] = useState(user?.active ?? true);
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
          ...(password ? { password } : {}),
        },
        done,
      );
    } else {
      create.mutate({ email, displayName, role, password }, done);
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
        <Group justify="flex-end">
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
