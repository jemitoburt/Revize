import { NumberInput } from '@mantine/core';

export interface IntervalFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Where the interval comes from when left empty, e.g. "z haly nebo typu vybavení". */
  inherited: string;
  error?: string;
  disabled?: boolean;
}

/** Own inspection interval in months; empty = inherited (item → location → site → type). */
export function IntervalField({ value, onChange, inherited, error, disabled }: IntervalFieldProps) {
  return (
    <NumberInput
      label="Interval kontrol (měsíce)"
      description={`Prázdné = ${inherited}`}
      placeholder="zděděný"
      min={1}
      max={120}
      allowDecimal={false}
      value={value ?? ''}
      error={error}
      disabled={disabled}
      onChange={(v) => onChange(v === '' || v === null ? null : Number(v))}
    />
  );
}
