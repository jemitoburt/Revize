import {
  Autocomplete,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import type { FieldDefinition } from '@revize/shared';
import { useState } from 'react';
import { useColumnValues } from '../api/hooks.js';

export interface Replacement {
  from: string;
  to: string;
  /** Not imported ("Přeskočit" in the problem list). */
  skip?: boolean;
}

export interface ImportFieldValuesProps {
  jobId: string;
  field: FieldDefinition;
  /** Mapped column, or null when the sheet has no column for the field. */
  column: number | null;
  replacements: Replacement[];
  defaultValue: string;
  opened: boolean;
  onClose: () => void;
  onSave: (replacements: Replacement[], defaultValue: string) => void;
}

const BOOLEAN_VALUES = ['ano', 'ne'];

/** A value input that offers the field's options (any other text is allowed too). */
export function ValueInput({
  field,
  value,
  onChange,
  label,
  ariaLabel,
  placeholder,
}: {
  field: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
  /** Visible label above the input. */
  label?: string;
  /** Accessible name without a visible label (inputs in the table). */
  ariaLabel?: string;
  placeholder?: string;
}) {
  const offered =
    field.kind === 'boolean' ? BOOLEAN_VALUES : [...field.options, ...field.suggestions];
  return offered.length ? (
    <Autocomplete
      aria-label={ariaLabel}
      label={label}
      placeholder={placeholder}
      data={[...new Set(offered)]}
      value={value}
      onChange={onChange}
    />
  ) : (
    <TextInput
      aria-label={ariaLabel}
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

/**
 * Values of one field for the whole import: a value for every item whose cell is empty (or
 * whose field has no column), and replacements of values found in the column.
 */
export function ImportFieldValues({
  jobId,
  field,
  column,
  replacements,
  defaultValue,
  opened,
  onClose,
  onSave,
}: ImportFieldValuesProps) {
  const values = useColumnValues(jobId, opened ? column : null);
  const [draftDefault, setDraftDefault] = useState(defaultValue);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(replacements.filter((r) => !r.skip).map((r) => [r.from, r.to])),
  );

  const save = () => {
    const typed = Object.entries(draft)
      .filter(([, to]) => to.trim() !== '')
      .map(([from, to]) => ({ from, to: to.trim() }));
    // Values skipped in the problem list stay skipped unless a replacement was typed for them.
    const skipped = replacements.filter((r) => r.skip && !typed.some((t) => t.from === r.from));
    onSave([...typed, ...skipped], draftDefault.trim());
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Hodnoty pole „${field.label}“`} size="lg">
      <Stack>
        <ValueInput
          field={field}
          label="Hodnota pro všechny artikly"
          placeholder={field.unit ? `např. 150 ${field.unit}` : undefined}
          value={draftDefault}
          onChange={setDraftDefault}
        />
        <Text size="sm" c="dimmed" mt={-10}>
          {column === null
            ? 'Soubor pro toto pole nemá sloupec: hodnota se vyplní u všech artiklů.'
            : 'Použije se u řádků, kde je buňka prázdná.'}{' '}
          Při aktualizaci existujících artiklů jejich vyplněnou hodnotu nepřepíše.
        </Text>

        {column !== null && (
          <>
            <Text fw={600} mt="sm">
              Nahradit hodnoty ve sloupci
            </Text>
            <Text size="sm" c="dimmed" mt={-10}>
              Náhrada platí pro všechny řádky se stejnou hodnotou (velikost písmen a diakritika
              nehrají roli).
            </Text>
            {values.isPending ? (
              <Loader size="sm" />
            ) : values.data?.length === 0 ? (
              <Text size="sm" c="dimmed">
                Sloupec je prázdný.
              </Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Table data-testid="column-values">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Hodnota v souboru</Table.Th>
                      <Table.Th>Řádků</Table.Th>
                      <Table.Th>Nahradit za</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {values.data?.map((v) => (
                      <Table.Tr key={v.value}>
                        <Table.Td>{v.value}</Table.Td>
                        <Table.Td>{v.count}</Table.Td>
                        <Table.Td>
                          <ValueInput
                            field={field}
                            ariaLabel={`Nahradit ${v.value}`}
                            placeholder={
                              replacements.some((r) => r.skip && r.from === v.value)
                                ? 'přeskočeno'
                                : 'ponechat'
                            }
                            value={draft[v.value] ?? ''}
                            onChange={(to) => setDraft((d) => ({ ...d, [v.value]: to }))}
                          />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Zrušit
          </Button>
          <Button onClick={save}>Použít</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
