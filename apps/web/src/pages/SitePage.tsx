import {
  Badge,
  Breadcrumbs,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import type { Site } from '@revize/shared';
import { useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AnchorLink, ButtonLink } from '../components/links.js';
import { useCustomer, useMe, useSite, useUpdateSite } from '../api/hooks.js';
import { IntervalField } from '../components/IntervalField.js';
import { LocationTree } from '../components/LocationTree.js';
import { notifyError, notifySaved } from '../lib/notify.js';

function EditSite({ site, onDone }: { site: Site; onDone: () => void }) {
  const update = useUpdateSite();
  const [name, setName] = useState(site.name);
  const [address, setAddress] = useState(site.address ?? '');
  const [note, setNote] = useState(site.note ?? '');
  const [interval, setInterval] = useState<number | null>(site.inspectionIntervalMonths);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      {
        id: site.id,
        version: site.version,
        name,
        address,
        note,
        inspectionIntervalMonths: interval,
      },
      { onSuccess: () => (notifySaved(), onDone()), onError: notifyError },
    );
  };
  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput
          label="Název"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label="Adresa"
          value={address}
          onChange={(e) => setAddress(e.currentTarget.value)}
        />
        <Textarea label="Poznámka" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <IntervalField
          value={interval}
          onChange={setInterval}
          inherited="podle typu vybavení (platí pro artikly celé provozovny, pokud je nemá hala nebo artikl jinak)"
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

export function SitePage() {
  const { siteId } = useParams({ from: '/app/provozovny/$siteId' });
  const site = useSite(siteId);
  const customer = useCustomer(site.data?.customerId ?? '');
  const update = useUpdateSite();
  const me = useMe();
  const canWrite = !!me.data?.permissions.includes('customer.write');
  const [opened, { open, close }] = useDisclosure();

  if (!site.data) return site.error ? <Text c="red">{site.error.message}</Text> : null;
  const s = site.data;

  const toggleArchive = () =>
    modals.openConfirmModal({
      title: s.archived ? 'Obnovit provozovnu?' : 'Archivovat provozovnu?',
      children: <Text size="sm">Data a historie kontrol zůstanou zachované.</Text>,
      onConfirm: () =>
        update.mutate(
          { id: s.id, version: s.version, archived: !s.archived },
          { onSuccess: () => notifySaved(), onError: notifyError },
        ),
    });

  return (
    <Stack>
      <Breadcrumbs>
        <AnchorLink to="/zakaznici">Zákazníci</AnchorLink>
        {customer.data && (
          <AnchorLink to="/zakaznici/$customerId" params={{ customerId: customer.data.id }}>
            {customer.data.name}
          </AnchorLink>
        )}
        <Text>{s.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between">
        <Stack gap={0}>
          <Group>
            <Title order={2}>{s.name}</Title>
            {s.archived && <Badge color="gray">archivována</Badge>}
          </Group>
          <Text c="dimmed">{s.address ?? ''}</Text>
        </Stack>
        <Group>
          <ButtonLink
            variant="default"
            to="/artikly"
            search={{ customerId: s.customerId, siteId: s.id }}
          >
            Artikly ({s.itemCount})
          </ButtonLink>
          {canWrite && (
            <>
              <Button variant="default" onClick={open}>
                Upravit
              </Button>
              <Button variant="subtle" color="gray" onClick={toggleArchive}>
                {s.archived ? 'Obnovit' : 'Archivovat'}
              </Button>
            </>
          )}
        </Group>
      </Group>
      <LocationTree siteId={s.id} canWrite={canWrite} />
      <Modal opened={opened} onClose={close} title="Upravit provozovnu">
        <EditSite site={s} onDone={close} />
      </Modal>
    </Stack>
  );
}
