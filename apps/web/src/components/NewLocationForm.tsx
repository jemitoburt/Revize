import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { LOCATION_SEPARATOR, type Location } from '@revize/shared';
import { useState } from 'react';

export interface NewLocationFormProps {
  locations: readonly Location[];
  /** Preselected parent (e.g. the row of the location picked so far). */
  parentId: string | null;
  onCreate: (parent: Location | null, name: string) => Promise<Location>;
  onCreated: (location: Location) => void;
  onCancel: () => void;
}

/** Adds a location under an existing one (or at the top), e.g. a position found in the field. */
export function NewLocationForm({
  locations,
  parentId,
  onCreate,
  onCreated,
  onCancel,
}: NewLocationFormProps) {
  const [parent, setParent] = useState<string | null>(parentId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = locations
    .filter((l) => !l.archived)
    .map((l) => ({ value: l.id, label: l.pathNames.join(LOCATION_SEPARATOR) }));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Zadejte název');
    const parentLocation = locations.find((l) => l.id === parent) ?? null;
    const siblings = locations.filter((l) => l.parentId === (parentLocation?.id ?? null));
    if (siblings.some((l) => l.name.toLocaleLowerCase('cs') === trimmed.toLocaleLowerCase('cs'))) {
      return setError('Takové umístění už tu je');
    }
    setSaving(true);
    try {
      onCreated(await onCreate(parentLocation, trimmed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper withBorder p="sm" data-testid="new-location">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Nové umístění
        </Text>
        <Select
          label="Nadřazené umístění"
          placeholder="Žádné (nejvyšší úroveň, např. hala)"
          searchable
          clearable
          data={options}
          value={parent}
          onChange={setParent}
        />
        <TextInput
          label="Název umístění"
          placeholder="Např. Řada 4 nebo Pozice 12"
          value={name}
          error={error}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Zrušit
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Přidat umístění
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
