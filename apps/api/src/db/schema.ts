import type { FieldDefinition } from '@revize/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Conventions (docs/architecture.md §3): UUID primary keys that clients may generate (v7),
// `organization_id` on every tenant table (ADR-0010), text + CHECK instead of PG enums
// (adding a value is a one-line migration), `version` for optimistic locking.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
const version = { version: integer('version').notNull().default(1) };
const tenant = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organization.id);

export const organization = pgTable('organization', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** Company details and protocol texts (`organizationSettingsSchema`). */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  /** Logo printed on protocols (FileStorage key). */
  logoKey: text('logo_key'),
  logoMimeType: text('logo_mime_type'),
  ...timestamps,
});

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    /** Stored lower-case; unique across organizations so that login needs only the e-mail. */
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
    ...version,
  },
  (t) => [
    uniqueIndex('app_user_email_key').on(t.email),
    check('app_user_role_check', sql`${t.role} in ('admin', 'inspector')`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    /** SHA-256 of the bearer token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    deviceLabel: text('device_label'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('session_token_hash_key').on(t.tokenHash),
    index('session_user_idx').on(t.userId),
  ],
);

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    name: text('name').notNull(),
    /** IČO */
    companyId: varchar('company_id', { length: 20 }),
    address: text('address'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    note: text('note'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
    ...version,
  },
  (t) => [index('customer_org_name_idx').on(t.organizationId, t.name)],
);

export const site = pgTable(
  'site',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    name: text('name').notNull(),
    address: text('address'),
    note: text('note'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
    ...version,
  },
  (t) => [index('site_customer_idx').on(t.customerId)],
);

/**
 * Location tree of a site (hall › row › position, any depth). `path_ids` (ancestors + self) and
 * `sort_path` (zero-padded sort orders) are maintained on write, so subtree queries and
 * "sorted by location" need no recursion.
 */
export const location = pgTable(
  'location',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => location.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    pathIds: uuid('path_ids').array().notNull(),
    sortPath: text('sort_path').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
    ...version,
  },
  (t) => [
    index('location_site_sort_idx').on(t.siteId, t.sortPath),
    index('location_path_ids_idx').using('gin', t.pathIds),
  ],
);

export const equipmentType = pgTable(
  'equipment_type',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    name: text('name').notNull(),
    fieldDefinitions: jsonb('field_definitions').$type<FieldDefinition[]>().notNull().default([]),
    defaultIntervalMonths: integer('default_interval_months').notNull().default(12),
    /** Text of the inspection protocol section for this type (placeholders allowed). */
    protocolTemplate: text('protocol_template').notNull().default(''),
    schemaVersion: integer('schema_version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
    ...version,
  },
  (t) => [
    uniqueIndex('equipment_type_org_name_key').on(t.organizationId, t.name),
    check('equipment_type_interval_check', sql`${t.defaultIntervalMonths} between 1 and 120`),
  ],
);

export const item = pgTable(
  'item',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    locationId: uuid('location_id').references(() => location.id),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id),
    /**
     * Numeric series of any length up to 8 digits, stored without leading zeros (ADR-0012),
     * unique within the customer.
     */
    itemNumber: varchar('item_number', { length: 8 }).notNull(),
    /** Content of the QR label; independent of the item number (phase 2 labels). */
    qrCode: text('qr_code'),
    fieldValues: jsonb('field_values').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('in_service'),
    nextInspectionDate: date('next_inspection_date'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => appUser.id),
    ...timestamps,
    ...version,
  },
  (t) => [
    uniqueIndex('item_customer_number_key').on(t.customerId, t.itemNumber),
    uniqueIndex('item_org_qr_key').on(t.organizationId, t.qrCode),
    index('item_site_idx').on(t.siteId),
    index('item_location_idx').on(t.locationId),
    index('item_next_inspection_idx').on(t.organizationId, t.nextInspectionDate),
    index('item_field_values_idx').using('gin', t.fieldValues),
    check('item_number_check', sql`${t.itemNumber} ~ '^[1-9][0-9]{0,7}$'`),
    check('item_status_check', sql`${t.status} in ('in_service', 'out_of_service')`),
  ],
);

/** Block of item numbers reserved by a device for creating items offline (ADR-0004). */
export const itemNumberLease = pgTable(
  'item_number_lease',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    deviceLabel: text('device_label'),
    rangeFrom: integer('range_from').notNull(),
    rangeTo: integer('range_to').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('item_number_lease_customer_idx').on(t.customerId),
    check('item_number_lease_range_check', sql`${t.rangeFrom} <= ${t.rangeTo}`),
  ],
);

export const inspection = pgTable(
  'inspection',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    leadInspectorId: uuid('lead_inspector_id')
      .notNull()
      .references(() => appUser.id),
    inspectionDate: date('inspection_date').notNull(),
    nextInspectionDate: date('next_inspection_date'),
    status: text('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => appUser.id),
    reopenedCount: integer('reopened_count').notNull().default(0),
    note: text('note'),
    ...timestamps,
    ...version,
  },
  (t) => [
    index('inspection_site_date_idx').on(t.siteId, t.inspectionDate),
    check('inspection_status_check', sql`${t.status} in ('open', 'closed')`),
  ],
);

export const inspectionInspector = pgTable(
  'inspection_inspector',
  {
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspection.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
  },
  (t) => [primaryKey({ columns: [t.inspectionId, t.userId] })],
);

/** Optional restriction of an inspection to some equipment types (none = all types). */
export const inspectionTypeScope = pgTable(
  'inspection_type_scope',
  {
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspection.id, { onDelete: 'cascade' }),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id),
  },
  (t) => [primaryKey({ columns: [t.inspectionId, t.equipmentTypeId] })],
);

/** One result per item and inspection; a missing row means "not checked" (ADR-0011). */
export const inspectionResult = pgTable(
  'inspection_result',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspection.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    outcome: text('outcome').notNull(),
    defectDescription: text('defect_description'),
    takenOutOfService: boolean('taken_out_of_service').notNull().default(false),
    /**
     * Defect severity by ČSN EN 15635 (traffic light): green = monitor, amber = repair soon,
     * red = unload and take out of service at once (`taken_out_of_service`). Null for OK.
     */
    severity: text('severity'),
    /** Minor (green/amber) defects can be left out of the protocol; red ones never are. */
    includeInProtocol: boolean('include_in_protocol').notNull().default(true),
    /** Time on the device when the technician recorded the result. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => appUser.id),
    ...timestamps,
    ...version,
  },
  (t) => [
    uniqueIndex('inspection_result_inspection_item_key').on(t.inspectionId, t.itemId),
    index('inspection_result_item_idx').on(t.itemId),
    check('inspection_result_outcome_check', sql`${t.outcome} in ('ok', 'defect')`),
    check(
      'inspection_result_out_of_service_check',
      sql`${t.outcome} = 'defect' or not ${t.takenOutOfService}`,
    ),
    check(
      'inspection_result_severity_check',
      sql`(${t.outcome} = 'ok' and ${t.severity} is null) or (${t.outcome} = 'defect' and ${t.severity} in ('green', 'amber', 'red'))`,
    ),
    check(
      'inspection_result_red_check',
      sql`${t.severity} is distinct from 'red' or (${t.takenOutOfService} and ${t.includeInProtocol})`,
    ),
  ],
);

/**
 * A photo belongs to exactly one owner: the item (nameplate, overview – kept across inspections),
 * an inspection result (defect photos) or the inspection as a whole (hall overview, access).
 */
export const photo = pgTable(
  'photo',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    itemId: uuid('item_id').references(() => item.id),
    inspectionResultId: uuid('inspection_result_id').references(() => inspectionResult.id),
    inspectionId: uuid('inspection_id').references(() => inspection.id),
    storageKey: text('storage_key').notNull(),
    thumbnailKey: text('thumbnail_key'),
    mimeType: text('mime_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    caption: text('caption'),
    createdBy: uuid('created_by').references(() => appUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('photo_item_idx').on(t.itemId),
    index('photo_result_idx').on(t.inspectionResultId),
    index('photo_inspection_idx').on(t.inspectionId),
    check(
      'photo_owner_check',
      sql`num_nonnulls(${t.itemId}, ${t.inspectionResultId}, ${t.inspectionId}) = 1`,
    ),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    actorUserId: uuid('actor_user_id').references(() => appUser.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

/**
 * An uploaded spreadsheet waiting for mapping, validation and commit (M4). The parsed rows are
 * kept here, so validation can be repeated with different mappings without uploading again.
 */
export const importJob = pgTable(
  'import_job',
  {
    id: uuid('id').primaryKey(),
    organizationId: tenant(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),
    fileName: text('file_name').notNull(),
    sheetName: text('sheet_name'),
    /** 1-based spreadsheet row of the header; data rows follow it. */
    headerRow: integer('header_row').notNull(),
    headers: jsonb('headers').$type<string[]>().notNull(),
    /** Cells as parsed (string, number, boolean, null; dates as ISO date strings). */
    rows: jsonb('rows').$type<(string | number | boolean | null)[][]>().notNull(),
    status: text('status').notNull().default('uploaded'),
    mapping: jsonb('mapping'),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    index('import_job_org_created_idx').on(t.organizationId, t.createdAt),
    check('import_job_status_check', sql`${t.status} in ('uploaded', 'committed')`),
  ],
);

/** Last used column mapping per equipment type (by header names), offered for the next file. */
export const importMapping = pgTable(
  'import_mapping',
  {
    organizationId: tenant(),
    equipmentTypeId: uuid('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id),
    headers: jsonb('headers').$type<Record<string, string | string[] | undefined>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.equipmentTypeId] })],
);
