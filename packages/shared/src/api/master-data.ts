import { z } from 'zod';
import { fieldDefinitionsSchema } from '../equipment-fields.js';
import { idSchema } from './common.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve formátu RRRR-MM-DD');
const version = z.number().int().describe('Optimistic locking: the version the client edited');

/** Archived records are hidden by default but stay for history (nothing is deleted). */
const archivedFlag = z.boolean();

// ---------- customers ----------

export const customerSchema = z.object({
  id: idSchema,
  name: z.string(),
  companyId: z.string().nullable(),
  address: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  note: z.string().nullable(),
  archived: z.boolean(),
  siteCount: z.number().int(),
  itemCount: z.number().int(),
  version: z.number().int(),
});
export type Customer = z.infer<typeof customerSchema>;

const customerFields = {
  name: z.string().trim().min(1, 'Zadejte název').max(200),
  companyId: optionalText(20),
  address: optionalText(300),
  contactName: optionalText(100),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === '' || z.email().safeParse(value).success, 'Neplatný e-mail')
    .transform((value) => (value === '' ? null : value.toLowerCase()))
    .nullable()
    .optional(),
  contactPhone: optionalText(50),
  note: optionalText(2000),
};

export const createCustomerSchema = z.object({ id: idSchema.optional(), ...customerFields });
export const updateCustomerSchema = z
  .object({ ...customerFields, archived: archivedFlag })
  .partial()
  .extend({ version });

// ---------- sites ----------

export const siteSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  name: z.string(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  archived: z.boolean(),
  itemCount: z.number().int(),
  version: z.number().int(),
});
export type Site = z.infer<typeof siteSchema>;

const siteFields = {
  name: z.string().trim().min(1, 'Zadejte název').max(200),
  address: optionalText(300),
  note: optionalText(2000),
};
export const createSiteSchema = z.object({ id: idSchema.optional(), ...siteFields });
export const updateSiteSchema = z
  .object({ ...siteFields, archived: archivedFlag })
  .partial()
  .extend({ version });

// ---------- locations ----------

export const locationSchema = z.object({
  id: idSchema,
  siteId: idSchema,
  parentId: idSchema.nullable(),
  name: z.string(),
  sortOrder: z.number().int(),
  /** Names from the root, e.g. ["Hala A", "Řada 3", "Pozice 12"]. */
  pathNames: z.array(z.string()),
  depth: z.number().int(),
  archived: z.boolean(),
  itemCount: z.number().int().describe('Items directly in this location'),
  version: z.number().int(),
});
export type Location = z.infer<typeof locationSchema>;

export const LOCATION_SEPARATOR = ' › ';

const sortOrder = z.number().int().min(0).max(999_999);

export const createLocationSchema = z.object({
  id: idSchema.optional(),
  parentId: idSchema.nullable(),
  name: z.string().trim().min(1, 'Zadejte název').max(100),
  /** Defaults to the next position after the last sibling. */
  sortOrder: sortOrder.optional(),
});

/** "Pozice 1" … "Pozice 20" under one parent in one step. */
export const createLocationSeriesSchema = z
  .object({
    parentId: idSchema.nullable(),
    prefix: z.string().trim().max(80),
    from: z.number().int().min(0).max(9999),
    to: z.number().int().min(0).max(9999),
  })
  .refine((v) => v.to >= v.from && v.to - v.from < 500, {
    message: 'Najednou lze založit nejvýš 500 umístění',
    path: ['to'],
  });

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    sortOrder,
    /** Moves the location with its whole subtree (null = top level). */
    parentId: idSchema.nullable(),
    archived: archivedFlag,
  })
  .partial()
  .extend({ version });

// ---------- equipment types ----------

export const equipmentTypeSchema = z.object({
  id: idSchema,
  name: z.string(),
  fieldDefinitions: fieldDefinitionsSchema,
  defaultIntervalMonths: z.number().int(),
  protocolTemplate: z.string(),
  /** Defects rated green/yellow/red after ČSN EN 15635 (racks); otherwise fit / unfit. */
  riskLevels: z.boolean(),
  schemaVersion: z.number().int(),
  archived: z.boolean(),
  itemCount: z.number().int(),
  version: z.number().int(),
});
export type EquipmentType = z.infer<typeof equipmentTypeSchema>;

const equipmentTypeFields = {
  name: z.string().trim().min(1, 'Zadejte název').max(100),
  fieldDefinitions: fieldDefinitionsSchema,
  defaultIntervalMonths: z.number().int().min(1).max(120),
  protocolTemplate: z.string().max(20_000),
  riskLevels: z.boolean(),
};
export const createEquipmentTypeSchema = z.union([
  z.object({
    id: idSchema.optional(),
    ...equipmentTypeFields,
    riskLevels: equipmentTypeFields.riskLevels.default(false),
  }),
  /** Copy of a library type; the name may be changed. */
  z.object({
    id: idSchema.optional(),
    presetKey: z.string(),
    name: equipmentTypeFields.name.optional(),
  }),
]);
export const updateEquipmentTypeSchema = z
  .object({ ...equipmentTypeFields, archived: archivedFlag })
  .partial()
  .extend({ version });

/** `POST /equipment-types/:id/conversion-preview`: what changing field kinds would do. */
export const conversionPreviewRequestSchema = z.object({
  fieldDefinitions: z.array(z.unknown()),
});
export const conversionSummarySchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    from: z.string(),
    to: z.string(),
    total: z.number().int(),
    converted: z.number().int(),
    problems: z.array(
      z.object({ value: z.string(), warning: z.string(), count: z.number().int() }),
    ),
  }),
);

export const equipmentTypePresetSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  standards: z.array(z.string()),
  defaultIntervalMonths: z.number().int(),
  fieldCount: z.number().int(),
});

// ---------- items ----------

export const ITEM_STATUSES = ['in_service', 'out_of_service'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  in_service: 'V provozu',
  out_of_service: 'Vyřazen z provozu',
};

export const itemSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  siteId: idSchema,
  locationId: idSchema.nullable(),
  locationPath: z.array(z.string()),
  equipmentTypeId: idSchema,
  equipmentTypeName: z.string(),
  itemNumber: z.string(),
  /** "Ž-01": prefix and number; unique within the site when set. */
  designation: z.string().nullable(),
  qrCode: z.string().nullable(),
  fieldValues: z.record(z.string(), z.unknown()),
  status: z.enum(ITEM_STATUSES),
  nextInspectionDate: z.string().nullable(),
  retired: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Item = z.infer<typeof itemSchema>;

const itemFields = {
  siteId: idSchema,
  locationId: idSchema.nullable(),
  equipmentTypeId: idSchema,
  /** Číslo TZ: 4 or 5 digits, unique in the organization; stored without leading zeros. */
  itemNumber: z.string().trim().max(5, 'Číslo TZ má nejvýš 5 číslic'),
  designation: optionalText(50),
  qrCode: optionalText(200),
  fieldValues: z.record(z.string(), z.unknown()),
  nextInspectionDate: isoDate.nullable(),
};

export const createItemSchema = z.object({
  id: idSchema.optional(),
  ...itemFields,
  /** Empty: the next free number of the customer is assigned. */
  itemNumber: itemFields.itemNumber.optional(),
  nextInspectionDate: itemFields.nextInspectionDate.optional(),
  qrCode: itemFields.qrCode,
  designation: itemFields.designation,
});

export const updateItemSchema = z
  .object({
    ...itemFields,
    status: z.enum(ITEM_STATUSES),
    /** Retired items stay in the records but are no longer inspected. */
    retired: z.boolean(),
    /** Required when the status changes (audited, e.g. returning an item to service). */
    reason: z.string().trim().max(500),
  })
  .partial()
  .extend({ version });

export const ITEM_SORTS = ['location', 'itemNumber', 'type', 'nextInspection', 'updated'] as const;

export const listItemsQuerySchema = z.object({
  customerId: idSchema.optional(),
  siteId: idSchema.optional(),
  equipmentTypeId: idSchema.optional(),
  /** Includes the whole subtree of the location. */
  locationId: idSchema.optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  /** Číslo TZ (prefix, leading zeros ignored), designation, QR code or any field value. */
  q: z.string().trim().max(100).optional(),
  includeRetired: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(ITEM_SORTS).default('location'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const itemListSchema = z.object({ items: z.array(itemSchema), total: z.number().int() });

export const bulkUpdateItemsSchema = z.object({
  ids: z.array(idSchema).min(1).max(1000),
  set: z
    .object({
      locationId: idSchema.nullable(),
      status: z.enum(ITEM_STATUSES),
      nextInspectionDate: isoDate.nullable(),
      retired: z.boolean(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Vyberte, co se má změnit'),
  reason: z.string().trim().max(500).optional(),
});
