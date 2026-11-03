import {
  Autocomplete,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { applyDefaultProducts, type FieldDefinition } from '@revize/shared';

export interface DynamicFieldsProps {
  definitions: readonly FieldDefinition[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Errors by field key. */
  errors?: Record<string, string>;
  disabled?: boolean;
}

/** Form controls generated from an equipment type's field definitions (ADR-0006). */
export function DynamicFields({
  definitions,
  values,
  onChange,
  errors = {},
  disabled,
}: DynamicFieldsProps) {
  const fields = definitions.filter((f) => !f.archived).sort((a, b) => a.order - b.order);
  // Fields with a default product (bay load = level load × levels) follow their inputs until
  // somebody overwrites them.
  const set = (key: string, value: unknown) =>
    onChange(applyDefaultProducts(definitions, { ...values, [key]: value }, values));

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      {fields.map((field) => {
        const common = {
          label: field.label,
          description: field.help,
          required: field.required,
          error: errors[field.key],
          disabled,
        };
        const value = values[field.key];
        switch (field.kind) {
          case 'text':
            return field.suggestions.length ? (
              <Autocomplete
                key={field.key}
                {...common}
                data={field.suggestions}
                value={(value as string) ?? ''}
                onChange={(v) => set(field.key, v)}
              />
            ) : (
              <TextInput
                key={field.key}
                {...common}
                value={(value as string) ?? ''}
                onChange={(e) => set(field.key, e.currentTarget.value)}
              />
            );
          case 'number':
          case 'integer':
            return (
              <NumberInput
                key={field.key}
                {...common}
                decimalSeparator=","
                allowDecimal={field.kind === 'number'}
                rightSection={
                  field.unit ? (
                    <Text size="xs" c="dimmed">
                      {field.unit}
                    </Text>
                  ) : undefined
                }
                rightSectionWidth={field.unit ? 44 : undefined}
                value={typeof value === 'number' ? value : ''}
                onChange={(v) => set(field.key, v === '' ? null : Number(v))}
              />
            );
          case 'select':
            return (
              <Select
                key={field.key}
                {...common}
                data={field.options}
                clearable={!field.required}
                value={(value as string) ?? null}
                onChange={(v) => set(field.key, v)}
              />
            );
          case 'multiselect':
            return (
              <MultiSelect
                key={field.key}
                {...common}
                data={field.options}
                value={(value as string[]) ?? []}
                onChange={(v) => set(field.key, v)}
              />
            );
          case 'boolean':
            return (
              <Stack key={field.key} gap={4}>
                <Text size="sm" fw={500}>
                  {field.label}
                  {field.required ? ' *' : ''}
                </Text>
                <SegmentedControl
                  aria-label={field.label}
                  disabled={disabled}
                  data={[
                    { value: 'yes', label: 'Ano' },
                    { value: 'no', label: 'Ne' },
                    { value: '', label: '–' },
                  ]}
                  value={value === true ? 'yes' : value === false ? 'no' : ''}
                  onChange={(v) => set(field.key, v === '' ? null : v === 'yes')}
                />
                {field.help && (
                  <Text size="xs" c="dimmed">
                    {field.help}
                  </Text>
                )}
                {errors[field.key] && (
                  <Text size="xs" c="red">
                    {errors[field.key]}
                  </Text>
                )}
              </Stack>
            );
          case 'date':
            return (
              <TextInput
                key={field.key}
                {...common}
                type="date"
                value={(value as string) ?? ''}
                onChange={(e) => set(field.key, e.currentTarget.value)}
              />
            );
        }
      })}
    </SimpleGrid>
  );
}

/** "fieldValues.rungs" → "rungs" for errors coming from the API. */
export function fieldValueErrors(errors: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (path.startsWith('fieldValues.')) result[path.split('.')[1]!] = message;
  }
  return result;
}
