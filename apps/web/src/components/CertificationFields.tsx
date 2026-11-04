import { Stack, Text, TextInput } from '@mantine/core';
import { useEquipmentTypes } from '../api/hooks.js';

export interface CertificationFieldsProps {
  general: string;
  perType: Record<string, string>;
  onGeneral: (value: string) => void;
  onPerType: (value: Record<string, string>) => void;
  error?: string;
}

/**
 * The technician's authorization: one per equipment type (printed in protocols of that type)
 * and a general one for the types without their own.
 */
export function CertificationFields({
  general,
  perType,
  onGeneral,
  onPerType,
  error,
}: CertificationFieldsProps) {
  const types = useEquipmentTypes();
  return (
    <Stack gap="xs">
      <TextInput
        label="Oprávnění technika (obecné)"
        description="Tiskne se pod podpisem protokolu u typů vybavení, které nemají vlastní oprávnění."
        placeholder="např. Osvědčení č. 42/2025"
        value={general}
        error={error}
        onChange={(e) => onGeneral(e.currentTarget.value)}
      />
      <Text size="sm" fw={600} mt="xs">
        Oprávnění podle typu vybavení
      </Text>
      {(types.data ?? [])
        .filter((t) => !t.archived)
        .map((t) => (
          <TextInput
            key={t.id}
            label={t.name}
            placeholder={general || 'stejné jako obecné'}
            value={perType[t.id] ?? ''}
            onChange={(e) => onPerType({ ...perType, [t.id]: e.currentTarget.value })}
          />
        ))}
    </Stack>
  );
}
