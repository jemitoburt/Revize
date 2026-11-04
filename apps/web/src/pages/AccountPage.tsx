import { Button, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useChangePassword, useMe, useUpdateProfile } from '../api/hooks.js';
import { CertificationFields } from '../components/CertificationFields.js';
import { notifyError, notifySaved } from '../lib/notify.js';

/** The own authorization, printed under the signature of the protocols one leads. */
function ProfileForm({
  certification: savedGeneral,
  certifications: savedPerType,
}: {
  certification: string;
  certifications: Record<string, string>;
}) {
  const update = useUpdateProfile();
  const [general, setGeneral] = useState(savedGeneral);
  const [perType, setPerType] = useState(savedPerType);
  return (
    <Paper withBorder p="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(
            { certification: general, certifications: perType },
            { onSuccess: () => notifySaved(), onError: notifyError },
          );
        }}
      >
        <Stack>
          <Title order={4}>Profil technika</Title>
          <CertificationFields
            general={general}
            perType={perType}
            onGeneral={setGeneral}
            onPerType={setPerType}
          />
          <Button type="submit" loading={update.isPending}>
            Uložit
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}

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
      {me.data && (
        <ProfileForm
          key={JSON.stringify([me.data.certification, me.data.certifications])}
          certification={me.data.certification}
          certifications={me.data.certifications}
        />
      )}
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
