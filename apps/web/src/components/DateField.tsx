import { DateInput, type DateInputProps } from '@mantine/dates';
import { parseDateInput } from '@revize/shared';
import { IconCalendar } from '@tabler/icons-react';

export interface DateFieldProps extends Omit<
  DateInputProps,
  'value' | 'onChange' | 'valueFormat' | 'dateParser'
> {
  /** ISO date (`2026-11-03`) or '' when empty. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Date input shown and typed as DD/MM/YYYY with a calendar (instead of the browser's date
 * input, whose format follows the device and which Safari pre-fills with today).
 */
export function DateField({ value, onChange, ...props }: DateFieldProps) {
  return (
    <DateInput
      valueFormat="DD/MM/YYYY"
      placeholder="DD/MM/RRRR"
      dateParser={(input) => parseDateInput(input)}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
      clearable
      leftSection={<IconCalendar size={16} />}
      {...props}
    />
  );
}
