import {
  ActionIcon,
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Group,
  List,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  fieldDefinitionsSchema,
  PROTOCOL_PLACEHOLDERS,
  fillProtocolTemplate,
  kindChanges,
  type ConversionSummary,
  type EquipmentType,
  type FieldDefinition,
  type FieldKind,
} from '@revize/shared';
import { useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { AnchorLink } from '../components/links.js';
import {
  useConversionPreview,
  useEquipmentType,
  useMe,
  useUpdateEquipmentType,
} from '../api/hooks.js';
import { DynamicFields } from '../components/DynamicFields.js';
import { formatDate, slugKey } from '../lib/format.js';
import { notifyError, notifySaved } from '../lib/notify.js';

interface DraftField extends FieldDefinition {
  uid: string;
  /** Exists in the saved type: the key is locked, it can only be archived (not removed). */
  saved: boolean;
  keyTouched: boolean;
}

const SAMPLE = {
  firma: 'Revizní firma s.r.o.',
  zakaznik: 'Ukázkový sklad s.r.o.',
  provozovna: 'Provozovna Brno',
  datum_kontroly: formatDate(new Date().toISOString()),
  technik: 'Jan Technik',
  datum_pristi_kontroly: formatDate(new Date(Date.now() + 365 * 864e5).toISOString()),
};

const kindOptions = FIELD_KINDS.map((k) => ({ value: k, label: FIELD_KIND_LABELS[k] }));

function toDraft(type: EquipmentType): DraftField[] {
  return [...type.fieldDefinitions]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ ...f, uid: f.key, saved: true, keyTouched: true }));
}

function Editor({ type, canWrite }: { type: EquipmentType; canWrite: boolean }) {
  const update = useUpdateEquipmentType();
  const [name, setName] = useState(type.name);
  const [interval, setInterval] = useState<number>(type.defaultIntervalMonths);
  const [template, setTemplate] = useState(type.protocolTemplate);
  const [fields, setFields] = useState<DraftField[]>(() => toDraft(type));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const definitions = useMemo<FieldDefinition[]>(
    () =>
      fields.map(({ uid: _u, saved: _s, keyTouched: _k, ...f }, index) => ({ ...f, order: index })),
    [fields],
  );

  const patch = (uid: string, changes: Partial<DraftField>) =>
    setFields((list) => list.map((f) => (f.uid === uid ? { ...f, ...changes } : f)));
  const move = (index: number, delta: -1 | 1) =>
    setFields((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });
  const addField = () =>
    setFields((list) => [
      ...list,
      {
        uid: crypto.randomUUID(),
        key: '',
        label: '',
        kind: 'text',
        required: false,
        options: [],
        suggestions: [],
        order: list.length,
        archived: false,
        saved: false,
        keyTouched: false,
      },
    ]);
  const insertPlaceholder = (key: string) => {
    const el = templateRef.current;
    const token = `{{${key}}}`;
    const at = el?.selectionStart ?? template.length;
    setTemplate((t) => t.slice(0, at) + token + t.slice(el?.selectionEnd ?? at));
    requestAnimationFrame(() => el?.focus());
  };

  const [conversion, setConversion] = useState<ConversionSummary[] | null>(null);
  const preview = useConversionPreview();

  /** With changed field kinds: show first what happens to the stored values. */
  const requestSave = () => {
    const changed = kindChanges(type.fieldDefinitions, definitions);
    if (!changed.length || type.itemCount === 0) return save();
    preview.mutate(
      { id: type.id, fieldDefinitions: definitions },
      { onSuccess: setConversion, onError: notifyError },
    );
  };

  const save = () => {
    setConversion(null);
    const parsed = fieldDefinitionsSchema.safeParse(definitions);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next);
      notifyError(new Error('Zkontrolujte zvýrazněná pole.'));
      return;
    }
    setErrors({});
    update.mutate(
      {
        id: type.id,
        version: type.version,
        name,
        defaultIntervalMonths: interval,
        protocolTemplate: template,
        fieldDefinitions: parsed.data,
      },
      {
        onSuccess: () => notifySaved(),
        onError: (error) => {
          const fieldErrors = error.fieldErrors();
          const mapped: Record<string, string> = {};
          for (const [path, message] of Object.entries(fieldErrors)) {
            mapped[path.replace(/^fieldDefinitions\./, '')] = message;
          }
          setErrors(mapped);
          notifyError(error);
        },
      },
    );
  };

  const toggleArchive = () =>
    modals.openConfirmModal({
      title: type.archived ? 'Obnovit typ?' : 'Archivovat typ?',
      children: (
        <Text size="sm">
          {type.archived
            ? 'Typ bude znovu dostupný pro nové artikly.'
            : 'Nové artikly tohoto typu nepůjde zakládat. Stávající artikly a jejich data zůstanou.'}
        </Text>
      ),
      onConfirm: () =>
        update.mutate(
          { id: type.id, version: type.version, archived: !type.archived },
          { onSuccess: () => notifySaved(), onError: notifyError },
        ),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{type.name}</Title>
          {type.archived && <Badge color="gray">archivován</Badge>}
          <Text c="dimmed" size="sm">
            {type.itemCount} artiklů · verze polí {type.schemaVersion}
          </Text>
        </Group>
        {canWrite && (
          <Group>
            <Button variant="subtle" color="gray" onClick={toggleArchive}>
              {type.archived ? 'Obnovit' : 'Archivovat'}
            </Button>
            <Button onClick={requestSave} loading={update.isPending || preview.isPending}>
              Uložit změny
            </Button>
          </Group>
        )}
      </Group>
      <Modal
        opened={conversion !== null}
        onClose={() => setConversion(null)}
        title="Změna druhu polí"
        size="lg"
      >
        <Stack>
          {conversion?.map((c) => (
            <Stack key={c.key} gap={4} data-testid={`conversion-${c.key}`}>
              <Text fw={600}>
                {c.label}: {FIELD_KIND_LABELS[c.from as FieldKind]} →{' '}
                {FIELD_KIND_LABELS[c.to as FieldKind]}
              </Text>
              <Text size="sm">
                Hodnot u artiklů: {c.total}, převede se bez výhrad: {c.converted}.
              </Text>
              {c.problems.length > 0 && (
                <>
                  <Text size="sm">
                    Tyto hodnoty se uloží upravené nebo zůstanou jako text (u artiklu je pak potřeba
                    je opravit):
                  </Text>
                  <List size="sm">
                    {c.problems.slice(0, 20).map((p) => (
                      <List.Item key={p.value}>
                        {p.warning} ({p.count}×)
                      </List.Item>
                    ))}
                  </List>
                </>
              )}
            </Stack>
          ))}
          <Text size="sm" c="dimmed">
            Původní hodnoty zůstanou v auditu každého artiklu.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConversion(null)}>
              Zpět
            </Button>
            <Button onClick={save} loading={update.isPending}>
              Převést a uložit
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Název typu"
            required
            disabled={!canWrite}
            value={name}
            error={errors.name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <NumberInput
            label="Výchozí interval kontrol"
            suffix=" měs."
            min={1}
            max={120}
            disabled={!canWrite}
            value={interval}
            onChange={(v) => setInterval(Number(v) || 12)}
          />
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Pole artiklu</Title>
          {canWrite && (
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addField}>
              Přidat pole
            </Button>
          )}
        </Group>
        {fields.length === 0 && (
          <Text c="dimmed" size="sm">
            Typ zatím nemá žádná pole.
          </Text>
        )}
        <Stack gap="sm">
          {fields.map((f, index) => {
            const err = (prop: string) => errors[`${index}.${prop}`];
            return (
              <Paper
                key={f.uid}
                withBorder
                p="sm"
                bg={f.archived ? 'gray.0' : undefined}
                data-testid="field-row"
              >
                <Group align="flex-start" wrap="nowrap">
                  <Stack gap={2} pt={22}>
                    <ActionIcon
                      variant="subtle"
                      disabled={!canWrite || index === 0}
                      aria-label="Nahoru"
                      onClick={() => move(index, -1)}
                    >
                      <IconArrowUp size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      disabled={!canWrite || index === fields.length - 1}
                      aria-label="Dolů"
                      onClick={() => move(index, 1)}
                    >
                      <IconArrowDown size={16} />
                    </ActionIcon>
                  </Stack>
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <SimpleGrid cols={{ base: 1, sm: 4 }}>
                      <TextInput
                        label="Popisek"
                        required
                        disabled={!canWrite}
                        value={f.label}
                        error={err('label')}
                        onChange={(e) => {
                          const label = e.currentTarget.value;
                          patch(f.uid, {
                            label,
                            ...(f.saved || f.keyTouched ? {} : { key: slugKey(label) }),
                          });
                        }}
                      />
                      <TextInput
                        label="Klíč"
                        description={f.saved ? 'Po uložení neměnný' : 'Technický název'}
                        disabled={!canWrite || f.saved}
                        value={f.key}
                        error={err('key')}
                        onChange={(e) =>
                          patch(f.uid, { key: e.currentTarget.value, keyTouched: true })
                        }
                      />
                      <Select
                        label="Druh"
                        data={kindOptions}
                        allowDeselect={false}
                        description={
                          f.saved &&
                          f.kind !== type.fieldDefinitions.find((d) => d.key === f.key)?.kind
                            ? 'Uložené hodnoty se převedou'
                            : undefined
                        }
                        disabled={!canWrite}
                        value={f.kind}
                        error={err('kind')}
                        onChange={(v) => patch(f.uid, { kind: (v as FieldKind) ?? 'text' })}
                      />
                      {(f.kind === 'number' || f.kind === 'integer') && (
                        <TextInput
                          label="Jednotka"
                          placeholder="mm, kg, m"
                          disabled={!canWrite}
                          value={f.unit ?? ''}
                          onChange={(e) =>
                            patch(f.uid, { unit: e.currentTarget.value || undefined })
                          }
                        />
                      )}
                    </SimpleGrid>
                    {(f.kind === 'select' || f.kind === 'multiselect') && (
                      <TagsInput
                        label="Hodnoty číselníku"
                        description="Napište hodnotu a potvrďte Enterem"
                        disabled={!canWrite}
                        value={f.options}
                        error={err('options')}
                        onChange={(options) => patch(f.uid, { options })}
                      />
                    )}
                    {f.kind === 'text' && (
                      <TagsInput
                        label="Nabízené hodnoty (nepovinné)"
                        description="Např. obvyklí výrobci; lze napsat i jinou hodnotu"
                        disabled={!canWrite}
                        value={f.suggestions}
                        onChange={(suggestions) => patch(f.uid, { suggestions })}
                      />
                    )}
                    <TextInput
                      label="Nápověda (nepovinné)"
                      disabled={!canWrite}
                      value={f.help ?? ''}
                      onChange={(e) => patch(f.uid, { help: e.currentTarget.value || undefined })}
                    />
                    <Group>
                      <Switch
                        label="Povinné"
                        disabled={!canWrite}
                        checked={f.required}
                        onChange={(e) => patch(f.uid, { required: e.currentTarget.checked })}
                      />
                      {f.saved && (
                        <Switch
                          label="Archivované (skryté, data zůstanou)"
                          disabled={!canWrite}
                          checked={f.archived}
                          onChange={(e) => patch(f.uid, { archived: e.currentTarget.checked })}
                        />
                      )}
                    </Group>
                  </Stack>
                  {canWrite && !f.saved && (
                    <Tooltip label="Odebrat nové pole">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        mt={22}
                        aria-label="Odebrat pole"
                        onClick={() => setFields((list) => list.filter((x) => x.uid !== f.uid))}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
        {errors.fieldDefinitions && (
          <Alert color="red" mt="sm">
            {errors.fieldDefinitions}
          </Alert>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="xs">
          Text protokolu
        </Title>
        {canWrite && (
          <Group gap="xs" mb="xs">
            <Text size="sm" c="dimmed">
              Vložit:
            </Text>
            {PROTOCOL_PLACEHOLDERS.map(([key, label]) => (
              <Button
                key={key}
                size="compact-xs"
                variant="light"
                onClick={() => insertPlaceholder(key)}
              >
                {label}
              </Button>
            ))}
          </Group>
        )}
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Textarea
            ref={templateRef}
            autosize
            minRows={8}
            disabled={!canWrite}
            aria-label="Text protokolu"
            value={template}
            onChange={(e) => setTemplate(e.currentTarget.value)}
          />
          <Paper bg="gray.0" p="sm">
            <Text size="xs" c="dimmed" mb={4}>
              Náhled s ukázkovými údaji
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {fillProtocolTemplate(template, SAMPLE)}
            </Text>
          </Paper>
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="xs">
          Náhled formuláře artiklu
        </Title>
        <DynamicFields
          definitions={definitions}
          values={previewValues}
          onChange={setPreviewValues}
        />
      </Paper>
    </Stack>
  );
}

export function EquipmentTypePage() {
  const { typeId } = useParams({ from: '/app/typy/$typeId' });
  const type = useEquipmentType(typeId);
  const me = useMe();
  if (!type.data) return type.error ? <Text c="red">{type.error.message}</Text> : null;
  return (
    <Stack>
      <Breadcrumbs>
        <AnchorLink to="/typy">Typy vybavení</AnchorLink>
        <Text>{type.data.name}</Text>
      </Breadcrumbs>
      {/* Remount after each save so that the draft starts from the stored version. */}
      <Editor
        key={type.data.version}
        type={type.data}
        canWrite={!!me.data?.permissions.includes('equipmentType.write')}
      />
    </Stack>
  );
}
