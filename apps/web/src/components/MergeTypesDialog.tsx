import {
  Alert,
  Button,
  Checkbox,
  Group,
  List,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { commonLeadingWords, type EquipmentType } from '@revize/shared';
import { useState } from 'react';
import { useMergePreview, useMergeTypes } from '../api/hooks.js';
import { notifyError, notifySaved } from '../lib/notify.js';

/**
 * Merges types into one (e.g. the old "Regál paletový / policový / …" into "Regál"): the target
 * keeps its settings, gets the missing fields, the items move over and keep their former type in
 * a field; the merged types are archived.
 */
export function MergeTypesDialog({
  types,
  onDone,
}: {
  types: EquipmentType[];
  onDone: (targetId: string) => void;
}) {
  const active = types.filter((t) => !t.archived);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const target = active.find((t) => t.id === targetId);
  const names = [target, ...sourceIds.map((id) => active.find((t) => t.id === id))]
    .filter(Boolean)
    .map((t) => t!.name);
  const suggested = commonLeadingWords(names) || target?.name || '';
  const [name, setName] = useState<string | null>(null);
  const [keepKind, setKeepKind] = useState(true);
  const racks = /reg[aá]l/i.test(suggested);
  const [kindLabel, setKindLabel] = useState<string | null>(null);
  const label = kindLabel ?? (racks ? 'Typ regálu' : 'Druh');
  const request =
    targetId && sourceIds.length
      ? {
          targetId,
          sourceIds,
          name: name ?? suggested,
          ...(keepKind
            ? { kindField: { key: racks && kindLabel === null ? 'rack_type' : 'kind', label } }
            : {}),
        }
      : null;
  const preview = useMergePreview(request);
  const merge = useMergeTypes();

  return (
    <Stack>
      <Select
        label="Cílový typ"
        description="Jeho nastavení zůstane (pole, interval, text protokolu, hodnocení rizika)."
        data={active.map((t) => ({ value: t.id, label: `${t.name} (${t.itemCount} artiklů)` }))}
        value={targetId}
        onChange={(v) => {
          setTargetId(v);
          setSourceIds((ids) => ids.filter((id) => id !== v));
        }}
        searchable
      />
      <MultiSelect
        label="Sloučit do něj typy"
        description="Jejich artikly přejdou do cílového typu, typy se archivují."
        data={active
          .filter((t) => t.id !== targetId)
          .map((t) => ({ value: t.id, label: `${t.name} (${t.itemCount} artiklů)` }))}
        value={sourceIds}
        onChange={setSourceIds}
        searchable
      />
      <TextInput
        label="Název sloučeného typu"
        value={name ?? suggested}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Checkbox
        label="Původní typ artiklu uložit do pole (např. „Paletový“)"
        checked={keepKind}
        onChange={(e) => setKeepKind(e.currentTarget.checked)}
      />
      {keepKind && (
        <TextInput
          label="Název pole"
          value={label}
          onChange={(e) => setKindLabel(e.currentTarget.value)}
        />
      )}
      {preview.isFetching && <Loader size="sm" />}
      {preview.data && (
        <Alert color="blue" title="Co se stane">
          <List size="sm">
            <List.Item>Převede se {preview.data.items} artiklů.</List.Item>
            {preview.data.addedFields.length > 0 && (
              <List.Item>Přibudou pole: {preview.data.addedFields.join(', ')}.</List.Item>
            )}
            {Object.keys(preview.data.kindValues).length > 0 && (
              <List.Item>
                Pole „{label}“:{' '}
                {Object.entries(preview.data.kindValues)
                  .map(([type, value]) => `${type} → ${value}`)
                  .join(', ')}
                .
              </List.Item>
            )}
            {preview.data.conflicts.length > 0 && (
              <List.Item>
                Stejný klíč, jiný druh pole (zůstává podle cílového typu):{' '}
                {preview.data.conflicts.join(', ')}.
              </List.Item>
            )}
          </List>
        </Alert>
      )}
      {preview.error && <Text c="red">{preview.error.message}</Text>}
      <Group justify="flex-end">
        <Button
          disabled={!request}
          loading={merge.isPending}
          onClick={() =>
            request &&
            merge.mutate(request, {
              onSuccess: () => {
                notifySaved('Typy sloučeny');
                onDone(request.targetId);
              },
              onError: notifyError,
            })
          }
        >
          Sloučit
        </Button>
      </Group>
    </Stack>
  );
}
