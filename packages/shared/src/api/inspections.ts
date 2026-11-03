import { z } from 'zod';
import { ITEM_STATUSES } from './master-data.js';
import { idSchema, isoDateTimeSchema } from './common.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve formátu RRRR-MM-DD');

export const INSPECTION_STATUSES = ['open', 'closed'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Fixed outcomes (ADR-0011); "out of service" is a defect with `takenOutOfService`. */
export const OUTCOMES = ['ok', 'defect'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Defect severity, traffic light of ČSN EN 15635: green = monitor, amber = repair soon,
 * red = unload and take out of service at once.
 */
export const SEVERITIES = ['green', 'amber', 'red'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const inspectionProgressSchema = z.object({
  /** Items of the site in the inspection's scope (not retired). */
  total: z.number().int(),
  checked: z.number().int(),
  ok: z.number().int(),
  defect: z.number().int(),
  outOfService: z.number().int(),
});
export type InspectionProgress = z.infer<typeof inspectionProgressSchema>;

export const inspectionSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  customerName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  leadInspectorId: idSchema,
  leadInspectorName: z.string(),
  inspectors: z.array(z.object({ id: idSchema, displayName: z.string() })),
  /** Empty = all equipment types. */
  equipmentTypeIds: z.array(idSchema),
  inspectionDate: z.string(),
  nextInspectionDate: z.string().nullable(),
  status: z.enum(INSPECTION_STATUSES),
  note: z.string().nullable(),
  progress: inspectionProgressSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Inspection = z.infer<typeof inspectionSchema>;

/** `PUT /inspections/:id` with a client id: starting twice returns the same inspection. */
export const startInspectionSchema = z.object({
  siteId: idSchema,
  inspectionDate: isoDate,
  equipmentTypeIds: z.array(idSchema).max(100).default([]),
  note: z.string().trim().max(2000).optional(),
});

export const listInspectionsQuerySchema = z.object({
  status: z.enum(INSPECTION_STATUSES).optional(),
  siteId: idSchema.optional(),
  customerId: idSchema.optional(),
});

export const inspectionResultSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  outcome: z.enum(OUTCOMES),
  defectDescription: z.string().nullable(),
  takenOutOfService: z.boolean(),
  severity: z.enum(SEVERITIES).nullable(),
  /** Minor defects can be left out of the protocol (red ones are always in it). */
  includeInProtocol: z.boolean(),
  recordedAt: z.string(),
  recordedBy: idSchema,
  recordedByName: z.string(),
  photoCount: z.number().int(),
  version: z.number().int(),
});
export type InspectionResult = z.infer<typeof inspectionResultSchema>;

/** One row of the technician's working list: the item and its result in this inspection. */
export const inspectionItemSchema = z.object({
  id: idSchema,
  itemNumber: z.string(),
  designation: z.string().nullable(),
  qrCode: z.string().nullable(),
  equipmentTypeId: idSchema,
  locationId: idSchema.nullable(),
  locationPath: z.array(z.string()),
  fieldValues: z.record(z.string(), z.unknown()),
  status: z.enum(ITEM_STATUSES),
  nextInspectionDate: z.string().nullable(),
  /** Photos of the item itself (nameplate, overview), kept across inspections. */
  itemPhotoCount: z.number().int(),
  result: inspectionResultSchema.nullable(),
});
export type InspectionItem = z.infer<typeof inspectionItemSchema>;

/**
 * `PUT /inspections/:id/results/:itemId`. Idempotent; when two technicians record the same item
 * the result with the later `recordedAt` (device time) wins (ADR-0004).
 */
export const recordResultSchema = z
  .object({
    id: idSchema,
    outcome: z.enum(OUTCOMES),
    defectDescription: z.string().trim().max(2000).nullable().default(null),
    /** Required for defects; older clients send only `takenOutOfService` (= red, else amber). */
    severity: z.enum(SEVERITIES).nullable().optional(),
    takenOutOfService: z.boolean().default(false),
    includeInProtocol: z.boolean().default(true),
    recordedAt: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.outcome === 'defect' && !value.defectDescription) {
      ctx.addIssue({
        code: 'custom',
        path: ['defectDescription'],
        message: 'Popište závadu',
      });
    }
    if (value.outcome === 'ok' && (value.takenOutOfService || value.severity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: 'Závažnost a vyřazení z provozu patří jen k závadě',
      });
    }
  })
  .transform((value) => {
    if (value.outcome === 'ok') {
      return { ...value, severity: null, takenOutOfService: false, includeInProtocol: true };
    }
    const severity: Severity = value.severity ?? (value.takenOutOfService ? 'red' : 'amber');
    // Red means out of service and always appears in the protocol.
    return {
      ...value,
      severity,
      takenOutOfService: severity === 'red',
      includeInProtocol: severity === 'red' || value.includeInProtocol,
    };
  });
export type RecordResultInput = z.input<typeof recordResultSchema>;

export const PHOTO_OWNERS = ['item', 'result', 'inspection'] as const;
export type PhotoOwner = (typeof PHOTO_OWNERS)[number];

export const PHOTO_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  thumbnailSize: 480,
} as const;

/** Text fields of the multipart `PUT /photos/:id` (sent before the file). */
export const uploadPhotoFieldsSchema = z
  .object({
    owner: z.enum(PHOTO_OWNERS),
    itemId: idSchema.optional(),
    inspectionId: idSchema.optional(),
    takenAt: isoDateTimeSchema.optional(),
    caption: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const need = (key: 'itemId' | 'inspectionId') => {
      if (!value[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'Chybí vlastník fotky' });
    };
    if (value.owner === 'item') need('itemId');
    if (value.owner === 'result') {
      need('itemId');
      need('inspectionId');
    }
    if (value.owner === 'inspection') need('inspectionId');
  });

export const photoSchema = z.object({
  id: idSchema,
  owner: z.enum(PHOTO_OWNERS),
  itemId: idSchema.nullable(),
  inspectionId: idSchema.nullable(),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sizeBytes: z.number().int(),
  hasThumbnail: z.boolean(),
  takenAt: z.string().nullable(),
  caption: z.string().nullable(),
  createdAt: z.string(),
});
export type Photo = z.infer<typeof photoSchema>;

/**
 * `GET /photos`: `itemId` → the item's own photos and its defect photos (only from
 * `inspectionId` when given); `inspectionId` alone → photos of the inspection as a whole.
 */
export const listPhotosQuerySchema = z
  .object({ itemId: idSchema.optional(), inspectionId: idSchema.optional() })
  .refine((q) => q.itemId || q.inspectionId, 'Zadejte artikl nebo kontrolu');

/** Office closes the inspection: results become read-only, items get their next date. */
export const closeInspectionSchema = z.object({
  /** For all checked items; empty = inspection date + the equipment type's interval. */
  nextInspectionDate: isoDate.nullable().default(null),
  note: z.string().trim().max(2000).optional(),
});

export const reopenInspectionSchema = z.object({
  reason: z.string().trim().min(3, 'Uveďte důvod znovuotevření').max(500),
});
