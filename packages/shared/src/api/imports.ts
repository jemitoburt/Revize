import { z } from 'zod';
import { importMappingSchema } from '../import/mapping.js';
import { idSchema } from './common.js';

export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 20_000,
  maxColumns: 200,
} as const;

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const importJobSchema = z.object({
  id: idSchema,
  fileName: z.string(),
  sheets: z.array(z.string()).describe('Sheet names (XLSX); empty for CSV'),
  sheet: z.string().nullable(),
  headerRow: z.number().int(),
  headers: z.array(z.string()),
  rowCount: z.number().int(),
  /** First rows for the mapping preview. */
  sample: z.array(z.array(cell)),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importSuggestionSchema = importMappingSchema
  .pick({ itemNumber: true, qrCode: true, nextInspectionDate: true, location: true, fields: true })
  .extend({ fromSavedMapping: z.boolean() });

export const IMPORT_ACTIONS = ['create', 'update', 'skip', 'error'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

const rowMessageSchema = z.object({
  column: z.number().int().nullable(),
  header: z.string().nullable(),
  message: z.string(),
});

export const importRowResultSchema = z.object({
  rowNumber: z.number().int(),
  action: z.enum(IMPORT_ACTIONS),
  itemNumber: z.string().nullable().describe('null = will be assigned automatically'),
  locationPath: z.array(z.string()),
  /** Errors: the row is not imported. */
  issues: z.array(rowMessageSchema),
  /** Warnings: the row is imported (value kept as text, new option value, missing value). */
  warnings: z.array(rowMessageSchema),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importReportSchema = z.object({
  summary: z.object({
    total: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    skip: z.number().int(),
    error: z.number().int(),
    /** Imported rows that have warnings. */
    warning: z.number().int(),
  }),
  /** Locations that will be created (names from the top). */
  newLocations: z.array(z.array(z.string())),
  /** Values that will be added to the options of select fields of the type. */
  newOptions: z.array(
    z.object({ fieldKey: z.string(), label: z.string(), values: z.array(z.string()) }),
  ),
  rows: z.array(importRowResultSchema),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const validateImportSchema = z.object({ mapping: importMappingSchema });
export const commitImportSchema = z.object({
  mapping: importMappingSchema,
  /** Import the valid rows and leave out rows with errors (otherwise any error stops the import). */
  skipErrors: z.boolean().default(false),
});

export const importResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  locationsCreated: z.number().int(),
});
export type ImportResult = z.infer<typeof importResultSchema>;
