import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { DEMO } from '../api/client.js';
import { useLogin } from '../api/hooks.js';
import { DemoLoginHint } from '../demo/DemoParts.js';

export function LoginPage() {
  const login = useLogin();
  const router = useRouter();
  const search = useSearch({ from: '/prihlaseni' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: () => {
          // Back to the page (with its filters) that required the login; only local paths.
          const next =
            search.next?.startsWith('/') && !search.next.startsWith('/prihlaseni')
              ? search.next
              : '/';
          router.history.push(next);
        },
      },
    );
  };

  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <Paper withBorder shadow="sm" p="xl" w={380} maw="100%">
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>Revize – přihlášení</Title>
            {DEMO && (
              <DemoLoginHint
                onPick={(demoEmail, demoPassword) => {
                  setEmail(demoEmail);
                  setPassword(demoPassword);
                }}
              />
            )}
            {login.error && <Alert color="red">{login.error.message}</Alert>}
            <TextInput
              label="E-mail"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Heslo"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={login.isPending}>
              Přihlásit
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
