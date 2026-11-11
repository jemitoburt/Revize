import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import {
  ITEM_STATUS_LABELS,
  LOCATION_SEPARATOR,
  buildFieldValuesSchema,
  itemLabel,
  missingRequiredFields,
  newId,
  type Item,
  type ItemStatus,
  type Location,
  type createItemSchema,
} from '@revize/shared';
import { IconPlus } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import type { ApiRequestError } from '../api/client.js';
import {
  type FieldItemChanges,
  useCreateItem,
  useCustomers,
  useEquipmentTypes,
  useFieldLocations,
  useSites,
  useUpdateItem,
} from '../api/hooks.js';
import { DynamicFields, fieldValueErrors } from './DynamicFields.js';
import { notifyError, notifySaved } from '../lib/notify.js';
import { IntervalField } from './IntervalField.js';
import { DateField } from './DateField.js';
import { NewLocationForm } from './NewLocationForm.js';

export interface ItemFormProps {
  item: Item | null;
  /** Preselected for a new item (from the list filters). */
  defaults?: {
    customerId?: string;
    siteId?: string;
    locationId?: string;
    equipmentTypeId?: string;
    itemNumber?: string;
    qrCode?: string;
  };
  /** Field mode: customer and site come from the inspection and cannot be changed. */
  fixedSite?: boolean;
  /** Field mode: only the equipment types of the inspection. */
  allowedTypeIds?: readonly string[];
  /**
   * Field mode: stores the new item on the device (outbox) instead of calling the API. Gets the
   * request body and the location path names for the preview.
   */
  onCreate?: (
    body: z.input<typeof createItemSchema> & { id: string },
    locationPath: string[],
  ) => Promise<void>;
  /**
   * Field mode: stores an edit on the device (outbox) instead of calling the API. Gets only the
   * changed fields and the location path names for the preview. Status, retirement and the
   * interval stay with the office.
   */
  onUpdate?: (changes: FieldItemChanges, locationPath: string[]) => Promise<void>;
  /** Field mode: adds a location on the device (outbox); offered next to the location select. */
  onCreateLocation?: (parent: Location | null, name: string) => Promise<Location>;
  /** Called with the saved item (not with field-mode items created through `onCreate`). */
  onDone: (saved?: Item) => void;
}

export function ItemForm({
  item,
  defaults = {},
  fixedSite,
  allowedTypeIds,
  onCreate,
  onUpdate,
  onCreateLocation,
  onDone,
}: ItemFormProps) {
  const [addingLocation, setAddingLocation] = useState(false);
  const create = useCreateItem();
  const update = useUpdateItem();
  const customers = useCustomers();
  const types = useEquipmentTypes(true);
  const [customerId, setCustomerId] = useState<string | null>(
    item?.customerId ?? defaults.customerId ?? null,
  );
  const sites = useSites(customerId);
  const [siteId, setSiteId] = useState<string | null>(item?.siteId ?? defaults.siteId ?? null);
  // Includes locations added in the field that are still on the device.
  const locations = useFieldLocations(siteId);
  const [locationId, setLocationId] = useState<string | null>(
    item?.locationId ?? defaults.locationId ?? null,
  );
  const [typeId, setTypeId] = useState<string | null>(
    item?.equipmentTypeId ?? defaults.equipmentTypeId ?? null,
  );
  const [itemNumber, setItemNumber] = useState(item?.itemNumber ?? defaults.itemNumber ?? '');
  const [qrCode, setQrCode] = useState(item?.qrCode ?? defaults.qrCode ?? '');
  const [designation, setDesignation] = useState(item?.designation ?? '');
  // Client id of a new item: a repeated save (e.g. after a timeout) cannot create it twice.
  const [createId] = useState(newId);
  const [nextInspection, setNextInspection] = useState(item?.nextInspectionDate ?? '');
  const [interval, setInterval] = useState<number | null>(item?.inspectionIntervalMonths ?? null);
  const [values, setValues] = useState<Record<string, unknown>>(item?.fieldValues ?? {});
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? 'in_service');
  const [reason, setReason] = useState('');
  const [retired, setRetired] = useState(item?.retired ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const type = types.data?.find((t) => t.id === typeId);
  const typeOptions = (types.data ?? [])
    .filter((t) => !t.archived || t.id === item?.equipmentTypeId)
    .filter((t) => !allowedTypeIds?.length || allowedTypeIds.includes(t.id))
    .map((t) => ({ value: t.id, label: t.archived ? `${t.name} (archivován)` : t.name }));
  const locationOptions = useMemo(
    () =>
      (locations.data ?? []).map((l) => ({
        value: l.id,
        label: l.pathNames.join(LOCATION_SEPARATOR),
      })),
    [locations.data],
  );
  const statusChanged = item !== null && status !== item.status;

  /** Changing the type keeps only values of fields that the new type has as well. */
  const changeType = (nextTypeId: string | null) => {
    setTypeId(nextTypeId);
    const nextType = types.data?.find((t) => t.id === nextTypeId);
    if (!nextType) return;
    const keys = new Set(nextType.fieldDefinitions.map((f) => f.key));
    setValues((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => keys.has(key))),
    );
  };

  // Errors that have no visible field (should not happen, but must never fail silently).
  const visibleFieldKeys = new Set(
    type?.fieldDefinitions.filter((f) => !f.archived).map((f) => `fieldValues.${f.key}`),
  );
  const FORM_KEYS = [
    'siteId',
    'locationId',
    'equipmentTypeId',
    'itemNumber',
    'designation',
    'qrCode',
    'nextInspectionDate',
    'reason',
  ];
  const otherErrors = Object.entries(errors).filter(
    ([key]) => !FORM_KEYS.includes(key) && !visibleFieldKeys.has(key),
  );

  const missing = type ? missingRequiredFields(type.fieldDefinitions, values) : [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!siteId) next.siteId = 'Vyberte provozovnu';
    if (!typeId) next.equipmentTypeId = 'Vyberte typ vybavení';
    if (statusChanged && !reason.trim()) next.reason = 'Uveďte důvod změny stavu';
    // Missing required values do not block saving (the item is incomplete, see the warning);
    // wrong values do.
    const parsed = type
      ? buildFieldValuesSchema(type.fieldDefinitions, { allowMissing: true }).safeParse(values)
      : null;
    if (parsed && !parsed.success) {
      for (const issue of parsed.error.issues)
        next[`fieldValues.${String(issue.path[0])}`] ??= issue.message;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed?.success) return;

    const handlers = {
      onSuccess: (saved: Item) => {
        notifySaved(item ? 'Artikl uložen' : `Artikl ${itemLabel(saved)} založen`);
        onDone(saved);
      },
      onError: (error: ApiRequestError) => {
        setErrors(error.fieldErrors());
        notifyError(error);
      },
    };
    const common = {
      siteId: siteId!,
      locationId,
      equipmentTypeId: typeId!,
      qrCode,
      designation,
      fieldValues: parsed.data,
      nextInspectionDate: nextInspection || null,
      inspectionIntervalMonths: interval,
    };
    if (item && onUpdate) {
      const edited: FieldItemChanges = {
        locationId,
        equipmentTypeId: typeId!,
        itemNumber,
        designation,
        qrCode,
        fieldValues: parsed.data,
        nextInspectionDate: nextInspection || null,
      };
      const before: Record<string, unknown> = {
        locationId: item.locationId,
        equipmentTypeId: item.equipmentTypeId,
        itemNumber: item.itemNumber,
        designation: item.designation ?? '',
        qrCode: item.qrCode ?? '',
        fieldValues: item.fieldValues,
        nextInspectionDate: item.nextInspectionDate,
      };
      const changes = Object.fromEntries(
        Object.entries(edited).filter(
          ([key, value]) => stableJson(value) !== stableJson(before[key]),
        ),
      ) as FieldItemChanges;
      if (Object.keys(changes).length === 0) return onDone();
      const path = locations.data?.find((l) => l.id === locationId)?.pathNames ?? [];
      onUpdate(changes, path).then(() => onDone(), notifyError);
      return;
    }
    if (item) {
      update.mutate(
        {
          id: item.id,
          version: item.version,
          ...common,
          itemNumber,
          ...(statusChanged ? { status, reason } : {}),
          ...(retired !== item.retired ? { retired } : {}),
        },
        handlers,
      );
    } else {
      // Empty: the item has no číslo TZ (racks; or filled in on site later, ADR-0020).
      const body = { id: createId, ...common, itemNumber: itemNumber.trim() || null };
      if (onCreate) {
        const path = locations.data?.find((l) => l.id === locationId)?.pathNames ?? [];
        onCreate(body, path).then(() => onDone(), notifyError);
        return;
      }
      create.mutate(body, handlers);
    }
  };

  return (
    // noValidate: all checks (incl. required fields) run in submit() and show on the fields.
    <form onSubmit={submit} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Zákazník"
            required
            searchable
            disabled={!!item || fixedSite}
            data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setSiteId(null);
              setLocationId(null);
            }}
          />
          <Select
            label="Provozovna"
            required
            disabled={fixedSite}
            data={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            value={siteId}
            error={errors.siteId}
            onChange={(v) => {
              setSiteId(v);
              setLocationId(null);
            }}
          />
          <Stack gap={4}>
            <Select
              label="Umístění"
              searchable
              clearable
              placeholder="Bez umístění"
              data={locationOptions}
              value={locationId}
              error={errors.locationId}
              onChange={setLocationId}
            />
            {onCreateLocation && siteId && !addingLocation && (
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconPlus size={14} />}
                onClick={() => setAddingLocation(true)}
                style={{ alignSelf: 'flex-start' }}
              >
                Nové umístění
              </Button>
            )}
          </Stack>
          {onCreateLocation && addingLocation && (
            <NewLocationForm
              locations={locations.data ?? []}
              parentId={
                locations.data?.find((l) => l.id === locationId)?.parentId ?? locationId ?? null
              }
              onCreate={onCreateLocation}
              onCreated={(created) => {
                setLocationId(created.id);
                setAddingLocation(false);
              }}
              onCancel={() => setAddingLocation(false)}
            />
          )}
          <Select
            label="Typ vybavení"
            required
            data={typeOptions}
            value={typeId}
            error={errors.equipmentTypeId}
            onChange={changeType}
          />
          <TextInput
            label="Číslo TZ"
            description="4 nebo 5 číslic, v celé evidenci jen jednou; prázdné = bez čísla TZ"
            inputMode="numeric"
            autoComplete="off"
            placeholder="bez čísla"
            value={itemNumber}
            error={errors.itemNumber}
            onChange={(e) => setItemNumber(e.currentTarget.value.replace(/\D/g, '').slice(0, 5))}
          />
          <TextInput
            label="Označení"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            description="Např. Ž-01 nebo A1-12 (předvolba a číslo), v provozovně jen jednou"
            value={designation}
            error={errors.designation}
            onChange={(e) => setDesignation(e.currentTarget.value)}
          />
          <TextInput
            label="QR kód štítku"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={qrCode}
            error={errors.qrCode}
            onChange={(e) => setQrCode(e.currentTarget.value)}
          />
          <DateField
            label="Příští kontrola"
            value={nextInspection ?? ''}
            error={errors.nextInspectionDate}
            onChange={setNextInspection}
          />
          {!onUpdate && (
            <IntervalField
              value={interval}
              onChange={setInterval}
              error={errors.inspectionIntervalMonths}
              inherited="z umístění (hala), provozovny nebo typu vybavení"
            />
          )}
        </SimpleGrid>

        {type ? (
          <DynamicFields
            definitions={type.fieldDefinitions}
            values={values}
            onChange={setValues}
            errors={fieldValueErrors(errors)}
          />
        ) : (
          <Text c="dimmed" size="sm">
            Po výběru typu se zobrazí jeho pole.
          </Text>
        )}
        {missing.length > 0 && (
          <Alert color="yellow" data-testid="item-incomplete">
            Chybí povinné údaje: {missing.join(', ')}. Artikl se uloží jako neúplný a půjde ho
            doplnit později (filtr Neúplné v Artiklech).
          </Alert>
        )}

        {item && !onUpdate && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Stav
            </Text>
            <SegmentedControl
              data={Object.entries(ITEM_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              value={status}
              onChange={(v) => setStatus(v as ItemStatus)}
            />
            {statusChanged && (
              <TextInput
                label="Důvod změny stavu"
                required
                value={reason}
                error={errors.reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
            )}
            <Switch
              label="Vyřazen z evidence (už se nekontroluje, zůstává v historii)"
              checked={retired}
              onChange={(e) => setRetired(e.currentTarget.checked)}
            />
          </Stack>
        )}
        {otherErrors.length > 0 && (
          <Alert color="red" title="Formulář nelze uložit">
            {otherErrors.map(([key, message]) => (
              <div key={key}>{message}</div>
            ))}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending || update.isPending}>
            {item ? 'Uložit' : 'Založit artikl'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** JSON with sorted object keys: the same values compare equal whatever their order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
