import { Badge, Button, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { normalizeText, type FieldDefinition, type ImportReport } from '@revize/shared';
import { useState } from 'react';
import { ValueInput } from './ImportFieldValues.js';

export interface ProblemGroup {
  field: string;
  value: string;
  message: string;
  rows: number[];
}

/** Problems with field values, one line per field and value ("Druh: „dvojitý“ – 4 řádky"). */
export function problemGroups(report: ImportReport): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const row of report.rows) {
    for (const warning of row.warnings) {
      if (!warning.field || warning.value === undefined) continue;
      const key = `${warning.field}|${normalizeText(warning.value)}`;
      const group = groups.get(key) ?? {
        field: warning.field,
        value: warning.value,
        message: warning.message,
        rows: [],
      };
      group.rows.push(row.rowNumber);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

export const problemKey = (field: string, value: string) => `${field}|${normalizeText(value)}`;

export interface ImportProblemsProps {
  report: ImportReport;
  definitions: readonly FieldDefinition[];
  /** Problems accepted as they are (hidden from the open ones). */
  accepted: ReadonlySet<string>;
  onReplace: (field: string, value: string, to: string) => void;
  onAccept: (field: string, value: string) => void;
  onSkip: (field: string, value: string) => void;
  busy: boolean;
}

/**
 * The list of problems of the dry run: for every field value that does not fit, replace it with
 * another value (in every row of that field), accept it as it is, or skip it (not imported).
 */
export function ImportProblems({
  report,
  definitions,
  accepted,
  onReplace,
  onAccept,
  onSkip,
  busy,
}: ImportProblemsProps) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const groups = problemGroups(report);
  const open = groups.filter((g) => !accepted.has(problemKey(g.field, g.value)));
  if (groups.length === 0) return null;
  const label = (key: string) => definitions.find((f) => f.key === key)?.label ?? key;

  return (
    <Paper withBorder p="md" data-testid="import-problems">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={4}>Seznam problémů</Title>
          <Text size="sm" c="dimmed">
            Otevřených {open.length} z {groups.length}
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          <b>Nahradit</b> změní hodnotu ve všech řádcích tohoto pole. <b>Přijmout</b> ji naimportuje
          tak, jak je. <b>Přeskočit</b> ji nenaimportuje a pole zůstane prázdné.
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pole</Table.Th>
              <Table.Th>Hodnota</Table.Th>
              <Table.Th>Problém</Table.Th>
              <Table.Th>Řádků</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => {
              const key = problemKey(g.field, g.value);
              const field = definitions.find((f) => f.key === g.field);
              const isAccepted = accepted.has(key);
              return (
                <Table.Tr key={key} data-testid="import-problem">
                  <Table.Td>{label(g.field)}</Table.Td>
                  <Table.Td fw={600}>{g.value}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c={isAccepted ? 'dimmed' : 'orange.8'}>
                      {g.message}
                    </Text>
                  </Table.Td>
                  <Table.Td>{g.rows.length}</Table.Td>
                  <Table.Td>
                    {replacing === key && field ? (
                      <Group gap="xs" wrap="nowrap">
                        <ValueInput
                          field={field}
                          ariaLabel={`Nahradit ${g.value} za`}
                          placeholder="nová hodnota"
                          value={to}
                          onChange={setTo}
                        />
                        <Button
                          size="xs"
                          disabled={!to.trim()}
                          loading={busy}
                          onClick={() => {
                            onReplace(g.field, g.value, to.trim());
                            setReplacing(null);
                          }}
                        >
                          Použít
                        </Button>
                        <Button size="xs" variant="default" onClick={() => setReplacing(null)}>
                          Zrušit
                        </Button>
                      </Group>
                    ) : isAccepted ? (
                      <Badge color="gray" variant="light">
                        přijato
                      </Badge>
                    ) : (
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            setReplacing(key);
                            setTo('');
                          }}
                        >
                          Nahradit
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => onAccept(g.field, g.value)}
                        >
                          Přijmout
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          color="gray"
                          loading={busy}
                          onClick={() => onSkip(g.field, g.value)}
                        >
                          Přeskočit
                        </Button>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Stack>
    </Paper>
  );
}
