import {
  Alert,
  Button,
  FileButton,
  Group,
  Image,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import type { Organization, OrganizationSettings } from '@revize/shared';
import { IconTrash, IconUpload } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import {
  useDeleteLogo,
  useLogoUrl,
  useOrganization,
  useUpdateOrganization,
  useServerStatus,
  useUploadLogo,
} from '../api/hooks.js';
import { AnchorLink } from '../components/links.js';
import { formatDateTime } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';

const FIELDS: { key: keyof OrganizationSettings; label: string; description?: string }[] = [
  { key: 'companyId', label: 'IČO' },
  { key: 'address', label: 'Adresa' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-mail' },
  { key: 'web', label: 'Web' },
  {
    key: 'certification',
    label: 'Oprávnění technika',
    description: 'Tiskne se u podpisu, např. „Osvědčení č. 42/2025“',
  },
  {
    key: 'protocolIssueDate',
    label: 'Datum vydání formuláře',
    description: 'V hlavičce každé stránky, např. „01.10.2026“',
  },
  { key: 'protocolVersion', label: 'Verze formuláře', description: 'V hlavičce, např. „1“' },
  {
    key: 'pageFooter',
    label: 'Text v zápatí stránek',
    description: 'Vlevo dole, např. „BOZP • PO • REVIZE“ (vpravo se tiskne web)',
  },
];

function Logo({ organization }: { organization: Organization }) {
  const url = useLogoUrl(organization.hasLogo, organization.updatedAt);
  const upload = useUploadLogo();
  const remove = useDeleteLogo();
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={600}>Logo v hlavičce protokolu</Text>
        {organization.hasLogo ? (
          url ? (
            <Image src={url} alt="Logo" mah={90} maw={280} fit="contain" />
          ) : (
            <Loader size="sm" />
          )
        ) : (
          <Text size="sm" c="dimmed">
            Bez loga se v hlavičce vytiskne název firmy.
          </Text>
        )}
        <Group>
          <FileButton
            accept="image/png,image/jpeg"
            onChange={(file) =>
              file &&
              upload.mutate(file, {
                onSuccess: () => notifySaved('Logo nahráno'),
                onError: notifyError,
              })
            }
          >
            {(props) => (
              <Button
                {...props}
                variant="light"
                leftSection={<IconUpload size={18} />}
                loading={upload.isPending}
              >
                Nahrát logo (PNG/JPEG)
              </Button>
            )}
          </FileButton>
          {organization.hasLogo && (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={18} />}
              loading={remove.isPending}
              onClick={() => remove.mutate(undefined, { onError: notifyError })}
            >
              Odebrat
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

function SettingsForm({ organization }: { organization: Organization }) {
  const update = useUpdateOrganization();
  const [name, setName] = useState(organization.name);
  const [settings, setSettings] = useState(organization.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof OrganizationSettings, value: string) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(
      { name, settings },
      {
        onSuccess: () => {
          setErrors({});
          notifySaved();
        },
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
        <TextInput
          label="Název firmy"
          required
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {FIELDS.map((f) => (
            <TextInput
              key={f.key}
              label={f.label}
              description={f.description}
              value={settings[f.key]}
              error={errors[`settings.${f.key}`]}
              onChange={(e) => set(f.key, e.currentTarget.value)}
            />
          ))}
        </SimpleGrid>
        <Textarea
          label="Doplňující text protokolu"
          description="Vytiskne se za standardními body na konci protokolu (např. platnost, upozornění)"
          autosize
          minRows={3}
          value={settings.protocolFooter}
          error={errors['settings.protocolFooter']}
          onChange={(e) => set('protocolFooter', e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={update.isPending}>
            Uložit
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Company details, logo and texts of the protocol (permission settings.manage). */
function ServerStatusPanel() {
  const status = useServerStatus();
  const webBuiltAt = import.meta.env.VITE_BUILT_AT as string | undefined;
  return (
    <Paper withBorder p="md">
      <Stack gap={6}>
        <Text fw={600}>Stav serveru</Text>
        <Text size="sm">
          Aplikace v prohlížeči sestavena: {webBuiltAt ? formatDateTime(webBuiltAt) : '–'}
        </Text>
        {status.isPending && <Loader size="sm" />}
        {status.error && <Text c="red">{status.error.message}</Text>}
        {status.data && (
          <>
            <Text size="sm">
              Server (API) sestaven:{' '}
              {status.data.apiBuiltAt ? formatDateTime(status.data.apiBuiltAt) : 'neznámo'}
            </Text>
            <Text size="sm">
              Fotky v databázi: {status.data.photos} (u závad {status.data.byOwner.result}, u
              artiklů {status.data.byOwner.item}, celkové fotky kontrol{' '}
              {status.data.byOwner.inspection})
            </Text>
            {status.data.missingFiles > 0 ? (
              <Alert color="red" title="Chybí soubory fotek">
                {status.data.missingFiles} z {status.data.photos} fotek nemá na serveru soubor.
                Úložiště souborů (svazek /data/files) se nejspíš při nasazení ztratilo nebo není
                připojené – viz příručka provozu.
              </Alert>
            ) : (
              <Text size="sm" c="teal">
                Soubory všech fotek jsou na serveru.
              </Text>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}

export function SettingsPage() {
  const organization = useOrganization();
  if (organization.isPending) return <Loader />;
  if (organization.error) return <Alert color="red">{organization.error.message}</Alert>;
  return (
    <Stack maw={900}>
      <Title order={2}>Nastavení firmy a protokolu</Title>
      <Text c="dimmed">
        Údaje se tisknou v hlavičce a v podpisové části protokolu. Text o rozsahu kontroly se
        nastavuje u každého typu vybavení v části <AnchorLink to="/typy">Typy vybavení</AnchorLink>.
      </Text>
      <Logo organization={organization.data} />
      <SettingsForm key={organization.data.updatedAt} organization={organization.data} />
      <ServerStatusPanel />
    </Stack>
  );
}
