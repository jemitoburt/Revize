import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Group,
  List,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import {
  IMPORT_LIMITS,
  type ImportJob,
  type ImportMappingInput,
  type ImportReport,
  type ImportResult,
  type ImportRowResult,
} from '@revize/shared';
import { useMemo, useState } from 'react';
import {
  useCommitImport,
  useCustomers,
  useEquipmentTypes,
  useImportSuggestion,
  useSites,
  useUploadImport,
  useValidateImport,
} from '../api/hooks.js';
import { downloadFile } from '../api/client.js';
import { ButtonLink } from '../components/links.js';
import { notifyError } from '../lib/notify.js';

type Mapping = Omit<ImportMappingInput, 'siteId' | 'equipmentTypeId'> & {
  itemNumber: number | null;
  qrCode: number | null;
  nextInspectionDate: number | null;
  location: number[];
  fields: Record<string, number | null>;
};

const LOCATION_LEVELS = 4;

const ACTION_BADGE: Record<ImportRowResult['action'], [string, string]> = {
  create: ['green', 'nový'],
  update: ['blue', 'aktualizace'],
  skip: ['gray', 'prázdný'],
  error: ['red', 'chyba'],
};

const cellText = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** Select of a source column with a preview of its first values. */
function ColumnSelect({
  label,
  required,
  job,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  job: ImportJob;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const options = [
    { value: '', label: '— nepoužít —' },
    ...job.headers.map((h, i) => ({ value: String(i), label: `${h} (sloupec ${i + 1})` })),
  ];
  const preview =
    value === null
      ? ''
      : job.sample
          .map((row) => cellText(row[value]))
          .filter(Boolean)
          .slice(0, 3)
          .join(' · ');
  return (
    <Table.Tr>
      <Table.Td w="30%">
        <Text fw={500}>
          {label}
          {required ? ' *' : ''}
        </Text>
      </Table.Td>
      <Table.Td w="35%">
        <Select
          aria-label={`Sloupec pro ${label}`}
          data={options}
          value={value === null ? '' : String(value)}
          allowDeselect={false}
          searchable
          onChange={(v) => onChange(v ? Number(v) : null)}
        />
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed" lineClamp={1}>
          {preview}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

export function ImportPage() {
  const customers = useCustomers();
  const types = useEquipmentTypes();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const sites = useSites(customerId);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [fromSaved, setFromSaved] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const upload = useUploadImport();
  const suggest = useImportSuggestion();
  const validate = useValidateImport();
  const commit = useCommitImport();
  const type = types.data?.find((t) => t.id === typeId);
  const fields = useMemo(
    () =>
      (type?.fieldDefinitions ?? []).filter((f) => !f.archived).sort((a, b) => a.order - b.order),
    [type],
  );
  const step = result ? 3 : report ? 2 : mapping ? 1 : 0;

  const loadFile = (sheet?: string) => {
    if (!file || !typeId || !siteId) return;
    upload.mutate(
      { file, ...(sheet ? { sheet } : {}) },
      {
        onSuccess: (uploaded) => {
          setJob(uploaded);
          setReport(null);
          suggest.mutate(
            { jobId: uploaded.id, equipmentTypeId: typeId },
            {
              onSuccess: ({ fromSavedMapping, ...suggested }) => {
                setFromSaved(fromSavedMapping);
                setMapping({
                  mode: 'create',
                  createMissingLocations: true,
                  autoNumber: true,
                  locationSeparator: '',
                  ...suggested,
                });
              },
              onError: notifyError,
            },
          );
        },
        onError: notifyError,
      },
    );
  };

  const fullMapping = (): ImportMappingInput | null =>
    mapping && siteId && typeId ? { ...mapping, siteId, equipmentTypeId: typeId } : null;

  const runValidation = () => {
    const m = fullMapping();
    if (!m || !job) return;
    validate.mutate({ jobId: job.id, mapping: m }, { onSuccess: setReport, onError: notifyError });
  };

  const runImport = () => {
    const m = fullMapping();
    if (!m || !job) return;
    commit.mutate(
      { jobId: job.id, mapping: m, skipErrors },
      { onSuccess: setResult, onError: notifyError },
    );
  };

  const restart = () => {
    setJob(null);
    setMapping(null);
    setReport(null);
    setResult(null);
    setFile(null);
    setSkipErrors(false);
  };

  const setLevel = (level: number, column: number | null) =>
    setMapping((m) => {
      if (!m) return m;
      const location = [...m.location];
      if (column === null) location.splice(level);
      else location[level] = column;
      return { ...m, location: location.filter((c) => c !== undefined) };
    });

  const rows = report?.rows.filter((r) => !onlyProblems || r.action === 'error') ?? [];
  const summary = report?.summary;

  return (
    <Stack>
      <Title order={2}>Import artiklů</Title>
      <Stepper active={step} allowNextStepsSelect={false}>
        <Stepper.Step label="Soubor" description="XLSX nebo CSV" />
        <Stepper.Step label="Mapování" description="sloupce → pole" />
        <Stepper.Step label="Kontrola" description="po řádcích" />
        <Stepper.Step label="Hotovo" />
      </Stepper>

      {step === 0 && (
        <Paper withBorder p="md">
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select
                label="Zákazník"
                searchable
                data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                value={customerId}
                onChange={(v) => {
                  setCustomerId(v);
                  setSiteId(null);
                }}
              />
              <Select
                label="Provozovna"
                disabled={!customerId}
                data={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                value={siteId}
                onChange={setSiteId}
              />
              <Select
                label="Typ vybavení"
                data={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                value={typeId}
                onChange={setTypeId}
              />
            </SimpleGrid>
            {typeId && (
              <Text size="sm">
                Nemáte vlastní seznam?{' '}
                <Anchor
                  component="button"
                  type="button"
                  onClick={() =>
                    downloadFile(
                      `/equipment-types/${typeId}/import-template`,
                      `import-${type?.name ?? 'sablona'}.xlsx`,
                    ).catch(notifyError)
                  }
                >
                  Stáhnout šablonu XLSX pro typ {type?.name}
                </Anchor>{' '}
                – po vyplnění se sloupce namapují samy.
              </Text>
            )}
            <FileInput
              label="Soubor"
              description={`XLSX nebo CSV (oddělovač i kódování se rozpoznají), nejvýš ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB`}
              placeholder="Vyberte soubor"
              accept=".xlsx,.csv,.txt"
              leftSection={<IconFileSpreadsheet size={16} />}
              value={file}
              onChange={setFile}
            />
            <Group justify="flex-end">
              <Button
                disabled={!file || !siteId || !typeId}
                loading={upload.isPending || suggest.isPending}
                onClick={() => loadFile()}
              >
                Načíst soubor
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {step === 1 && job && mapping && (
        <Stack>
          <Paper withBorder p="md">
            <Group justify="space-between">
              <Text>
                <b>{job.fileName}</b>
                {job.sheet ? ` · list „${job.sheet}“` : ''} · {job.rowCount} řádků · záhlaví na
                řádku {job.headerRow}
              </Text>
              {job.sheets.length > 1 && (
                <Select
                  aria-label="List sešitu"
                  data={job.sheets}
                  value={job.sheet}
                  allowDeselect={false}
                  onChange={(sheet) => sheet && loadFile(sheet)}
                />
              )}
            </Group>
            {fromSaved && (
              <Text size="sm" c="dimmed" mt={4}>
                Mapování je předvyplněné podle posledního importu tohoto typu.
              </Text>
            )}
          </Paper>

          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Sloupce
            </Title>
            <Table>
              <Table.Tbody>
                <ColumnSelect
                  label="Číslo artiklu"
                  job={job}
                  value={mapping.itemNumber}
                  onChange={(v) => setMapping({ ...mapping, itemNumber: v })}
                />
                <ColumnSelect
                  label="QR kód"
                  job={job}
                  value={mapping.qrCode}
                  onChange={(v) => setMapping({ ...mapping, qrCode: v })}
                />
                <ColumnSelect
                  label="Příští kontrola"
                  job={job}
                  value={mapping.nextInspectionDate}
                  onChange={(v) => setMapping({ ...mapping, nextInspectionDate: v })}
                />
                {Array.from(
                  { length: Math.min(LOCATION_LEVELS, mapping.location.length + 1) },
                  (_, level) => (
                    <ColumnSelect
                      key={`level-${level}`}
                      label={`Umístění – úroveň ${level + 1}`}
                      job={job}
                      value={mapping.location[level] ?? null}
                      onChange={(v) => setLevel(level, v)}
                    />
                  ),
                )}
                {fields.map((f) => (
                  <ColumnSelect
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    job={job}
                    value={mapping.fields[f.key] ?? null}
                    onChange={(v) =>
                      setMapping({ ...mapping, fields: { ...mapping.fields, [f.key]: v } })
                    }
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Paper>

          <Paper withBorder p="md">
            <Stack>
              <SegmentedControl
                data={[
                  { value: 'create', label: 'Jen nové artikly' },
                  { value: 'upsert', label: 'Nové i aktualizovat existující (podle čísla)' },
                ]}
                value={mapping.mode}
                onChange={(mode) => setMapping({ ...mapping, mode: mode as 'create' | 'upsert' })}
              />
              <Switch
                label="Chybějící umístění založit"
                checked={mapping.createMissingLocations}
                onChange={(e) =>
                  setMapping({ ...mapping, createMissingLocations: e.currentTarget.checked })
                }
              />
              <Switch
                label="Artiklům bez čísla přidělit další volné číslo"
                checked={mapping.autoNumber}
                onChange={(e) => setMapping({ ...mapping, autoNumber: e.currentTarget.checked })}
              />
              <TextInput
                label="Oddělovač úrovní v jednom sloupci umístění (nepovinné)"
                description="Např. „/“ pro hodnoty jako „Hala A / Řada 1 / Pozice 3“"
                w={420}
                maw="100%"
                value={mapping.locationSeparator}
                onChange={(e) =>
                  setMapping({ ...mapping, locationSeparator: e.currentTarget.value })
                }
              />
            </Stack>
          </Paper>
          <Group justify="space-between">
            <Button variant="default" onClick={restart}>
              Jiný soubor
            </Button>
            <Button onClick={runValidation} loading={validate.isPending}>
              Zkontrolovat
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && report && summary && (
        <Stack>
          <Paper withBorder p="md">
            <Group>
              <Badge size="lg" color="green">
                Nové: {summary.create}
              </Badge>
              <Badge size="lg" color="blue">
                Aktualizace: {summary.update}
              </Badge>
              <Badge size="lg" color="gray">
                Prázdné řádky: {summary.skip}
              </Badge>
              <Badge size="lg" color="red">
                Chyby: {summary.error}
              </Badge>
            </Group>
            {report.newLocations.length > 0 && (
              <Stack gap={4} mt="sm">
                <Text size="sm" fw={500}>
                  Založí se umístění ({report.newLocations.length}):
                </Text>
                <List size="sm">
                  {report.newLocations.slice(0, 15).map((path) => (
                    <List.Item key={path.join('/')}>{path.join(' › ')}</List.Item>
                  ))}
                  {report.newLocations.length > 15 && <List.Item>… a další</List.Item>}
                </List>
              </Stack>
            )}
          </Paper>
          {summary.error > 0 && (
            <Alert color="red" title="Některé řádky mají chyby">
              Opravte je v souboru a nahrajte ho znovu, upravte mapování, nebo naimportujte jen
              bezchybné řádky.
            </Alert>
          )}
          <Group>
            <SegmentedControl
              data={[
                { value: 'problems', label: 'Jen chyby' },
                { value: 'all', label: 'Všechny řádky' },
              ]}
              value={onlyProblems ? 'problems' : 'all'}
              onChange={(v) => setOnlyProblems(v === 'problems')}
            />
          </Group>
          <Table striped data-testid="import-report">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Řádek</Table.Th>
                <Table.Th>Výsledek</Table.Th>
                <Table.Th>Číslo</Table.Th>
                <Table.Th>Umístění</Table.Th>
                <Table.Th>Problémy</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.slice(0, 500).map((r) => (
                <Table.Tr key={r.rowNumber}>
                  <Table.Td>{r.rowNumber}</Table.Td>
                  <Table.Td>
                    <Badge color={ACTION_BADGE[r.action][0]}>{ACTION_BADGE[r.action][1]}</Badge>
                  </Table.Td>
                  <Table.Td ff="monospace">
                    {r.itemNumber ?? (r.action === 'create' ? 'automaticky' : '')}
                  </Table.Td>
                  <Table.Td>{r.locationPath.join(' › ')}</Table.Td>
                  <Table.Td>
                    {r.issues.map((issue, i) => (
                      <Text key={i} size="sm" c="red">
                        {issue.header ? `${issue.header}: ` : ''}
                        {issue.message}
                      </Text>
                    ))}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rows.length === 0 && <Text c="dimmed">Žádné řádky s chybami.</Text>}
          {rows.length > 500 && <Text c="dimmed">Zobrazeno prvních 500 řádků.</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={() => setReport(null)}>
              Zpět k mapování
            </Button>
            <Group>
              {summary.error > 0 && (
                <Checkbox
                  label="Přeskočit řádky s chybami"
                  checked={skipErrors}
                  onChange={(e) => setSkipErrors(e.currentTarget.checked)}
                />
              )}
              <Button
                color="green"
                disabled={
                  (summary.error > 0 && !skipErrors) || summary.create + summary.update === 0
                }
                loading={commit.isPending}
                onClick={runImport}
              >
                Importovat {summary.create + summary.update} artiklů
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {step === 3 && result && (
        <Paper withBorder p="md">
          <Stack>
            <Title order={4}>Import dokončen</Title>
            <Text>
              Nových artiklů: <b>{result.created}</b> · aktualizovaných: <b>{result.updated}</b> ·
              přeskočených řádků: <b>{result.skipped}</b> · nových umístění:{' '}
              <b>{result.locationsCreated}</b>
            </Text>
            <Group>
              {customerId && siteId && (
                <ButtonLink to="/artikly" search={{ customerId, siteId }}>
                  Zobrazit artikly
                </ButtonLink>
              )}
              <Button variant="default" onClick={restart}>
                Další import
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
