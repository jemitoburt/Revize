import { Button, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useChangePassword, useMe } from '../api/hooks.js';
import { notifyError, notifySaved } from '../lib/notify.js';

export function AccountPage() {
  const me = useMe();
  const change = useChangePassword();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const mismatch = repeat !== '' && repeat !== newPassword;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          notifySaved('Heslo změněno. Ostatní zařízení byla odhlášena.');
          setCurrent('');
          setNew('');
          setRepeat('');
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack maw={480}>
      <Title order={2}>Můj účet</Title>
      <Text>
        {me.data?.displayName} · {me.data?.email}
      </Text>
      <Paper withBorder p="md">
        <form onSubmit={submit}>
          <Stack>
            <Title order={4}>Změna hesla</Title>
            <PasswordInput
              label="Současné heslo"
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.currentTarget.value)}
            />
            <PasswordInput
              label="Nové heslo"
              required
              value={newPassword}
              onChange={(e) => setNew(e.currentTarget.value)}
            />
            <PasswordInput
              label="Nové heslo znovu"
              required
              error={mismatch ? 'Hesla se neshodují' : undefined}
              value={repeat}
              onChange={(e) => setRepeat(e.currentTarget.value)}
            />
            <Button type="submit" loading={change.isPending} disabled={mismatch}>
              Změnit heslo
            </Button>
          </Stack>
        </form>
      </Paper>
    </Stack>
  );
}
