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
  newId,
  type Item,
  type ItemStatus,
} from '@revize/shared';
import { useMemo, useState, type FormEvent } from 'react';
import type { ApiRequestError } from '../api/client.js';
import {
  useCreateItem,
  useCustomers,
  useEquipmentTypes,
  useLocations,
  useSites,
  useUpdateItem,
} from '../api/hooks.js';
import { DynamicFields, fieldValueErrors } from './DynamicFields.js';
import { notifyError, notifySaved } from '../lib/notify.js';

export interface ItemFormProps {
  item: Item | null;
  /** Preselected for a new item (from the list filters). */
  defaults?: {
    customerId?: string;
    siteId?: string;
    locationId?: string;
    equipmentTypeId?: string;
    qrCode?: string;
  };
  /** Field mode: customer and site come from the inspection and cannot be changed. */
  fixedSite?: boolean;
  /** Field mode: only the equipment types of the inspection. */
  allowedTypeIds?: readonly string[];
  /** Called with the saved item. */
  onDone: (saved?: Item) => void;
}

export function ItemForm({
  item,
  defaults = {},
  fixedSite,
  allowedTypeIds,
  onDone,
}: ItemFormProps) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const customers = useCustomers();
  const types = useEquipmentTypes(true);
  const [customerId, setCustomerId] = useState<string | null>(
    item?.customerId ?? defaults.customerId ?? null,
  );
  const sites = useSites(customerId);
  const [siteId, setSiteId] = useState<string | null>(item?.siteId ?? defaults.siteId ?? null);
  const locations = useLocations(siteId);
  const [locationId, setLocationId] = useState<string | null>(
    item?.locationId ?? defaults.locationId ?? null,
  );
  const [typeId, setTypeId] = useState<string | null>(
    item?.equipmentTypeId ?? defaults.equipmentTypeId ?? null,
  );
  const [itemNumber, setItemNumber] = useState(item?.itemNumber ?? '');
  const [qrCode, setQrCode] = useState(item?.qrCode ?? defaults.qrCode ?? '');
  // Client id of a new item: a repeated save (e.g. after a timeout) cannot create it twice.
  const [createId] = useState(newId);
  const [nextInspection, setNextInspection] = useState(item?.nextInspectionDate ?? '');
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
    'qrCode',
    'nextInspectionDate',
    'reason',
  ];
  const otherErrors = Object.entries(errors).filter(
    ([key]) => !FORM_KEYS.includes(key) && !visibleFieldKeys.has(key),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!siteId) next.siteId = 'Vyberte provozovnu';
    if (!typeId) next.equipmentTypeId = 'Vyberte typ vybavení';
    if (statusChanged && !reason.trim()) next.reason = 'Uveďte důvod změny stavu';
    const parsed = type ? buildFieldValuesSchema(type.fieldDefinitions).safeParse(values) : null;
    if (parsed && !parsed.success) {
      for (const issue of parsed.error.issues)
        next[`fieldValues.${String(issue.path[0])}`] ??= issue.message;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed?.success) return;

    const handlers = {
      onSuccess: (saved: Item) => {
        notifySaved(item ? 'Artikl uložen' : `Artikl ${saved.itemNumber} založen`);
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
      fieldValues: parsed.data,
      nextInspectionDate: nextInspection || null,
    };
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
      create.mutate(
        { id: createId, ...common, ...(itemNumber.trim() ? { itemNumber } : {}) },
        handlers,
      );
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
          <Select
            label="Typ vybavení"
            required
            data={typeOptions}
            value={typeId}
            error={errors.equipmentTypeId}
            onChange={changeType}
          />
          <TextInput
            label="Číslo artiklu"
            description="1–8 číslic; prázdné = další volné číslo"
            inputMode="numeric"
            placeholder={item ? undefined : 'automaticky'}
            value={itemNumber}
            error={errors.itemNumber}
            onChange={(e) => setItemNumber(e.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
          />
          <TextInput
            label="QR kód štítku"
            value={qrCode}
            error={errors.qrCode}
            onChange={(e) => setQrCode(e.currentTarget.value)}
          />
          <TextInput
            label="Příští kontrola"
            type="date"
            value={nextInspection ?? ''}
            error={errors.nextInspectionDate}
            onChange={(e) => setNextInspection(e.currentTarget.value)}
          />
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

        {item && (
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
