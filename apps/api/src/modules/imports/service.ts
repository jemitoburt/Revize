import {
  buildRowCandidate,
  cellText,
  designationOf,
  mappingHeaders,
  newId,
  normalizeDesignation,
  normalizeText,
  type FieldDefinition,
  suggestMapping,
  type ImportJob,
  type ImportMapping,
  type ImportReport,
  type ImportResult,
  type ImportRowResult,
  type RawCell,
  type RowCandidate,
  type SavedHeaders,
} from '@revize/shared';
import { and, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import {
  auditLog,
  equipmentType,
  importJob,
  importMapping,
  item,
  location,
  site,
} from '../../db/schema.js';
import { AppError, notFound, validationError } from '../../errors.js';
import { recordAudit } from '../audit/service.js';
import { insertLocation } from '../locations/service.js';
import { parseSpreadsheet } from './parse.js';

type JobRow = typeof importJob.$inferSelect;
type ItemRow = typeof item.$inferSelect;
type LocationRow = typeof location.$inferSelect;

const SAMPLE_ROWS = 10;
const INSERT_CHUNK = 500;

/** Key of a location path for tolerant matching ("Hala A › Řada 1" = "hala a / rada 1"). */
const pathKey = (names: readonly string[]) => names.map(normalizeText).join('\u0001');

interface PlannedRow {
  candidate: RowCandidate;
  result: ImportRowResult;
  existing: ItemRow | null;
}

interface Analysis {
  report: ImportReport;
  planned: PlannedRow[];
  type: typeof equipmentType.$inferSelect;
  customerId: string;
  locationsByKey: Map<string, LocationRow>;
}

/** Option values that rows bring into select fields, merged per field (first spelling wins). */
function newOptionsOf(definitions: FieldDefinition[], rows: PlannedRow[]) {
  return definitions.flatMap((field) => {
    const known = new Set(field.options.map(normalizeText));
    const values: string[] = [];
    for (const { candidate } of rows) {
      for (const value of candidate.newOptions[field.key] ?? []) {
        if (known.has(normalizeText(value))) continue;
        known.add(normalizeText(value));
        values.push(value);
      }
    }
    return values.length ? [{ fieldKey: field.key, label: field.label, values }] : [];
  });
}

function toJobDto(job: JobRow, sheets: string[]): ImportJob {
  return {
    id: job.id,
    fileName: job.fileName,
    sheets,
    sheet: job.sheetName,
    headerRow: job.headerRow,
    headers: job.headers,
    rowCount: job.rows.length,
    sample: job.rows.slice(0, SAMPLE_ROWS),
  };
}

/** Uses the trailing number of a name as sort order ("Pozice 12" → 12) so new ones sort numerically. */
function sortOrderFromName(name: string, fallback: number): number {
  const match = /(\d{1,6})\s*$/.exec(name);
  return match ? Number(match[1]) : fallback;
}

export function createImportsService(db: Db) {
  async function getJob(tx: DbOrTx, auth: AuthContext, id: string): Promise<JobRow> {
    const [job] = await tx
      .select()
      .from(importJob)
      .where(and(eq(importJob.organizationId, auth.organizationId), eq(importJob.id, id)));
    if (!job) throw notFound('Import neexistuje.');
    return job;
  }

  async function targetOf(tx: DbOrTx, auth: AuthContext, mapping: ImportMapping) {
    const [targetSite] = await tx
      .select()
      .from(site)
      .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, mapping.siteId)));
    if (!targetSite || targetSite.archivedAt) {
      throw validationError([
        { path: ['mapping', 'siteId'], message: 'Provozovna neexistuje nebo je archivovaná' },
      ]);
    }
    const [type] = await tx
      .select()
      .from(equipmentType)
      .where(
        and(
          eq(equipmentType.organizationId, auth.organizationId),
          eq(equipmentType.id, mapping.equipmentTypeId),
        ),
      );
    if (!type || type.archivedAt) {
      throw validationError([
        { path: ['mapping', 'equipmentTypeId'], message: 'Typ neexistuje nebo je archivovaný' },
      ]);
    }
    return { targetSite, type };
  }

  /** Checks every row against the mapping, the type and the database, without writing anything. */
  async function analyze(
    tx: DbOrTx,
    auth: AuthContext,
    job: JobRow,
    mapping: ImportMapping,
  ): Promise<Analysis> {
    const { targetSite, type } = await targetOf(tx, auth, mapping);
    const definitions = type.fieldDefinitions;
    const rowNumber = (index: number) => job.headerRow + 1 + index;
    const header = (column: number | null) =>
      column === null ? null : (job.headers[column] ?? null);

    // First pass: item numbers, to look up existing items whose values are the base for updates.
    const first = job.rows.map((row, i) =>
      buildRowCandidate(row as RawCell[], rowNumber(i), mapping, definitions),
    );
    const numbers = [
      ...new Set(first.map((c) => c.itemNumber).filter((n): n is string => n !== null)),
    ];
    const existingByNumber = new Map<string, ItemRow>();
    for (let i = 0; i < numbers.length; i += INSERT_CHUNK) {
      const rows = await tx
        .select()
        .from(item)
        .where(
          and(
            // Číslo TZ is unique in the whole organization (ADR-0012).
            eq(item.organizationId, auth.organizationId),
            inArray(item.itemNumber, numbers.slice(i, i + INSERT_CHUNK)),
          ),
        );
      rows.forEach((r) => existingByNumber.set(r.itemNumber, r));
    }
    // Designations of the site's items (unique within the site).
    const existingByDesignation = new Map<string, ItemRow>();
    if (mapping.designation !== null) {
      const rows = await tx
        .select()
        .from(item)
        .where(
          and(
            eq(item.siteId, targetSite.id),
            isNull(item.retiredAt),
            isNotNull(item.designationKey),
          ),
        );
      rows.forEach((r) => existingByDesignation.set(r.designationKey!, r));
    }

    const siteLocations = await tx
      .select()
      .from(location)
      .where(and(eq(location.siteId, targetSite.id), isNull(location.archivedAt)));
    const namesById = new Map(siteLocations.map((l) => [l.id, l.name]));
    const locationsByKey = new Map(
      siteLocations.map(
        (l) => [pathKey(l.pathIds.map((id) => namesById.get(id) ?? '')), l] as const,
      ),
    );

    const qrCodes = [...new Set(first.map((c) => c.qrCode).filter((q): q is string => q !== null))];
    const qrOwners = new Map<string, string>();
    for (let i = 0; i < qrCodes.length; i += INSERT_CHUNK) {
      const rows = await tx
        .select({ id: item.id, qrCode: item.qrCode })
        .from(item)
        .where(
          and(
            eq(item.organizationId, auth.organizationId),
            inArray(item.qrCode, qrCodes.slice(i, i + INSERT_CHUNK)),
          ),
        );
      rows.forEach((r) => qrOwners.set(r.qrCode!, r.id));
    }

    const seenNumbers = new Map<string, number>();
    const seenQr = new Map<string, number>();
    const newLocations = new Map<string, string[]>();
    const planned: PlannedRow[] = [];

    const seenDesignations = new Map<string, number>();
    for (const [index, firstCandidate] of first.entries()) {
      const designationKey = firstCandidate.designation
        ? normalizeDesignation(firstCandidate.designation) || null
        : null;
      // Without číslo TZ, an update finds the item by its designation in the site.
      const existing = firstCandidate.itemNumber
        ? (existingByNumber.get(firstCandidate.itemNumber) ?? null)
        : designationKey && mapping.mode === 'upsert'
          ? (existingByDesignation.get(designationKey) ?? null)
          : null;
      const updating = existing !== null && mapping.mode === 'upsert';
      const candidate = updating
        ? buildRowCandidate(
            job.rows[index] as RawCell[],
            firstCandidate.rowNumber,
            mapping,
            definitions,
            existing.fieldValues,
          )
        : firstCandidate;
      const issues = candidate.issues.map((i) => ({ ...i, header: header(i.column) }));
      const warnings = candidate.warnings.map((i) => ({ ...i, header: header(i.column) }));
      const add = (column: number | null, message: string) =>
        issues.push({ column, header: header(column), message });

      if (candidate.empty) {
        planned.push({
          candidate,
          existing: null,
          result: {
            rowNumber: candidate.rowNumber,
            action: 'skip',
            itemNumber: null,
            designation: null,
            locationPath: [],
            issues: [],
            warnings: [],
          },
        });
        continue;
      }

      if (candidate.itemNumber) {
        const earlier = seenNumbers.get(candidate.itemNumber);
        if (earlier !== undefined)
          add(
            mapping.itemNumber,
            `Číslo ${candidate.itemNumber} je v souboru už na řádku ${earlier}`,
          );
        else seenNumbers.set(candidate.itemNumber, candidate.rowNumber);
        if (existing && existing.customerId !== targetSite.customerId) {
          add(mapping.itemNumber, `Číslo TZ ${candidate.itemNumber} už má artikl jiného zákazníka`);
        } else if (existing && mapping.mode === 'create') {
          add(
            mapping.itemNumber,
            `Artikl ${candidate.itemNumber} už v evidenci je (zvolte „aktualizovat existující“)`,
          );
        }
        if (updating && existing.equipmentTypeId !== type.id) {
          add(mapping.itemNumber, `Artikl ${candidate.itemNumber} je v evidenci jiného typu`);
        }
        if (updating && existing.retiredAt)
          add(mapping.itemNumber, `Artikl ${candidate.itemNumber} je vyřazený z evidence`);
      }

      if (designationKey) {
        const earlier = seenDesignations.get(designationKey);
        if (earlier !== undefined)
          add(
            mapping.designation,
            `Označení ${candidate.designation} je v souboru už na řádku ${earlier}`,
          );
        else seenDesignations.set(designationKey, candidate.rowNumber);
        const owner = existingByDesignation.get(designationKey);
        if (owner && owner.id !== existing?.id)
          add(
            mapping.designation,
            `Označení ${candidate.designation} už v provozovně má artikl ${owner.itemNumber}`,
          );
      }

      if (candidate.qrCode) {
        const earlier = seenQr.get(candidate.qrCode);
        if (earlier !== undefined)
          add(mapping.qrCode, `QR kód je v souboru už na řádku ${earlier}`);
        else seenQr.set(candidate.qrCode, candidate.rowNumber);
        const owner = qrOwners.get(candidate.qrCode);
        if (owner && owner !== existing?.id)
          add(mapping.qrCode, `QR kód ${candidate.qrCode} už má jiný artikl`);
      }

      if (candidate.locationPath.length) {
        const key = pathKey(candidate.locationPath);
        if (!locationsByKey.has(key)) {
          if (mapping.createMissingLocations) newLocations.set(key, candidate.locationPath);
          else
            add(
              mapping.location[0] ?? null,
              `Umístění „${candidate.locationPath.join(' › ')}“ neexistuje`,
            );
        }
      }

      planned.push({
        candidate,
        existing: updating ? existing : null,
        result: {
          rowNumber: candidate.rowNumber,
          action: issues.length ? 'error' : updating ? 'update' : 'create',
          itemNumber: candidate.itemNumber ?? (updating ? existing.itemNumber : null),
          designation: candidate.designation,
          locationPath: candidate.locationPath,
          issues,
          warnings,
        },
      });
    }

    const rows = planned.map((p) => p.result);
    const count = (action: ImportRowResult['action']) =>
      rows.filter((r) => r.action === action).length;
    const imported = planned.filter(
      (p) => p.result.action === 'create' || p.result.action === 'update',
    );
    return {
      report: {
        summary: {
          total: rows.length,
          create: count('create'),
          update: count('update'),
          skip: count('skip'),
          error: count('error'),
          warning: imported.filter((p) => p.result.warnings.length > 0).length,
        },
        newLocations: [...newLocations.values()],
        newOptions: newOptionsOf(definitions, imported),
        rows,
      },
      planned,
      type,
      customerId: targetSite.customerId,
      locationsByKey,
    };
  }

  /** Creates missing locations level by level; returns the location id for every path key. */
  /** The new option values of the rows that are actually imported. */
  function newOptionsReport(analysis: Analysis) {
    const imported = analysis.planned.filter(
      (p) => p.result.action === 'create' || p.result.action === 'update',
    );
    return { newOptions: newOptionsOf(analysis.type.fieldDefinitions, imported) };
  }

  async function ensureLocations(
    tx: DbOrTx,
    auth: AuthContext,
    siteId: string,
    analysis: Analysis,
  ) {
    const byKey = new Map([...analysis.locationsByKey].map(([k, l]) => [k, l] as const));
    let created = 0;
    for (const path of analysis.report.newLocations) {
      let parent: LocationRow | null = null;
      for (let depth = 1; depth <= path.length; depth++) {
        const key = pathKey(path.slice(0, depth));
        let current = byKey.get(key) ?? null;
        if (!current) {
          const [last] = await tx
            .select({ value: max(location.sortOrder) })
            .from(location)
            .where(
              and(
                eq(location.siteId, siteId),
                parent ? eq(location.parentId, parent.id) : isNull(location.parentId),
              ),
            );
          const name = path[depth - 1]!;
          current = await insertLocation(tx, auth, siteId, parent, {
            id: newId(),
            name,
            sortOrder: sortOrderFromName(name, (last?.value ?? 0) + 1),
          });
          byKey.set(key, current);
          created++;
        }
        parent = current;
      }
    }
    return { byKey, created };
  }

  return {
    async upload(
      auth: AuthContext,
      fileName: string,
      buffer: Buffer,
      sheet?: string,
    ): Promise<ImportJob> {
      const parsed = await parseSpreadsheet(fileName, buffer, sheet);
      const [job] = await db
        .insert(importJob)
        .values({
          id: newId(),
          organizationId: auth.organizationId,
          createdBy: auth.userId,
          fileName,
          sheetName: parsed.sheet,
          headerRow: parsed.headerRow,
          headers: parsed.headers,
          rows: parsed.rows,
        })
        .returning();
      return toJobDto(job!, parsed.sheets);
    },

    async suggestion(auth: AuthContext, jobId: string, equipmentTypeId: string) {
      const job = await getJob(db, auth, jobId);
      const [type] = await db
        .select()
        .from(equipmentType)
        .where(
          and(
            eq(equipmentType.organizationId, auth.organizationId),
            eq(equipmentType.id, equipmentTypeId),
          ),
        );
      if (!type) throw notFound('Typ vybavení neexistuje.');
      const [saved] = await db
        .select()
        .from(importMapping)
        .where(
          and(
            eq(importMapping.organizationId, auth.organizationId),
            eq(importMapping.equipmentTypeId, equipmentTypeId),
          ),
        );
      // Replacements and defaults of fields the type still has.
      const keys = new Set(type.fieldDefinitions.map((f) => f.key));
      const pick = <T>(record: Record<string, T> | undefined) =>
        Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => keys.has(key)));
      return {
        ...suggestMapping(
          job.headers,
          type.fieldDefinitions,
          (saved?.headers ?? {}) as SavedHeaders,
        ),
        replacements: pick(saved?.values.replacements),
        defaults: pick(saved?.values.defaults),
        fromSavedMapping: saved !== undefined,
      };
    },

    /** Distinct values of one column with their counts (most frequent first, at most 200). */
    async columnValues(auth: AuthContext, jobId: string, column: number) {
      const job = await getJob(db, auth, jobId);
      if (column >= job.headers.length) throw notFound('Sloupec v souboru není.');
      const counts = new Map<string, number>();
      for (const row of job.rows as RawCell[][]) {
        const text = cellText(row[column] ?? null);
        if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'))
        .slice(0, 200)
        .map(([value, count]) => ({ value, count }));
    },

    async validate(
      auth: AuthContext,
      jobId: string,
      mapping: ImportMapping,
    ): Promise<ImportReport> {
      const job = await getJob(db, auth, jobId);
      return (await analyze(db, auth, job, mapping)).report;
    },

    /** Writes the valid rows in one transaction; any error stops it unless `skipErrors`. */
    async commit(
      auth: AuthContext,
      jobId: string,
      mapping: ImportMapping,
      skipErrors: boolean,
    ): Promise<ImportResult> {
      return db.transaction(async (tx) => {
        // Lock the job so that a double click cannot import the same file twice.
        await tx.execute(
          sql`select 1 from ${importJob} where ${importJob.id} = ${jobId} for update`,
        );
        const job = await getJob(tx, auth, jobId);
        if (job.status === 'committed')
          throw new AppError(409, 'import_committed', 'Tento soubor už byl naimportován.');

        const analysis = await analyze(tx, auth, job, mapping);
        const { summary } = analysis.report;
        if (summary.error > 0 && !skipErrors) {
          throw new AppError(
            409,
            'import_has_errors',
            `Import obsahuje ${summary.error} řádků s chybami.`,
          );
        }
        if (summary.create + summary.update === 0)
          throw new AppError(400, 'import_empty', 'Není co importovat.');

        // Only locations needed by rows that are actually imported.
        const importedKeys = new Set(
          analysis.planned
            .filter((p) => p.result.action === 'create' || p.result.action === 'update')
            .map((p) => pathKey(p.candidate.locationPath)),
        );
        analysis.report.newLocations = analysis.report.newLocations.filter((p) =>
          importedKeys.has(pathKey(p)),
        );
        // New option values go into the type first, so that the item values match its lists.
        const { newOptions } = newOptionsReport(analysis);
        if (newOptions.length) {
          const added = new Map(newOptions.map((o) => [o.fieldKey, o.values]));
          const fieldDefinitions = analysis.type.fieldDefinitions.map((f) =>
            added.has(f.key) ? { ...f, options: [...f.options, ...added.get(f.key)!] } : f,
          );
          const [changed] = await tx
            .update(equipmentType)
            .set({
              fieldDefinitions,
              version: analysis.type.version + 1,
              schemaVersion: analysis.type.schemaVersion + 1,
              updatedAt: new Date(),
            })
            .where(eq(equipmentType.id, analysis.type.id))
            .returning();
          await recordAudit(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'equipmentType.update',
            entityType: 'equipment_type',
            entityId: analysis.type.id,
            before: analysis.type,
            after: changed,
            reason: `Import ${job.fileName}: nové hodnoty číselníku`,
          });
        }

        const { byKey, created: locationsCreated } = await ensureLocations(
          tx,
          auth,
          mapping.siteId,
          analysis,
        );
        const locationIdOf = (path: string[]) =>
          path.length ? (byKey.get(pathKey(path))?.id ?? null) : null;

        // Next free numbers for rows without one (numbers used in the file are skipped).
        const [highest] = await tx
          .select({ value: sql<string | null>`max(${item.itemNumber}::bigint)::text` })
          .from(item)
          .where(
            and(eq(item.organizationId, auth.organizationId), sql`length(${item.itemNumber}) <= 5`),
          );
        const inFile = analysis.planned
          .map((p) => p.candidate.itemNumber)
          .filter((n): n is string => n !== null);
        // Číslo TZ has 4 or 5 digits: the series starts at 1000.
        let next = Math.max(999, ...[highest?.value ?? '0', ...inFile].map(Number));
        const nextNumber = () => {
          if (++next > 99_999) throw new AppError(409, 'numbers_exhausted', 'Došla čísla TZ.');
          return String(next);
        };

        const now = new Date();
        const inserts: (typeof item.$inferInsert)[] = [];
        const audits: (typeof auditLog.$inferInsert)[] = [];
        let updated = 0;

        for (const { candidate, result, existing } of analysis.planned) {
          if (result.action === 'create') {
            const row = {
              id: newId(),
              organizationId: auth.organizationId,
              customerId: analysis.customerId,
              siteId: mapping.siteId,
              locationId: locationIdOf(candidate.locationPath),
              equipmentTypeId: mapping.equipmentTypeId,
              itemNumber: candidate.itemNumber ?? nextNumber(),
              ...designationOf(candidate.designation),
              qrCode: candidate.qrCode,
              fieldValues: candidate.fieldValues,
              nextInspectionDate: candidate.nextInspectionDate,
              createdBy: auth.userId,
            };
            inserts.push(row);
            audits.push({
              id: newId(),
              organizationId: auth.organizationId,
              actorUserId: auth.userId,
              action: 'item.import',
              entityType: 'item',
              entityId: row.id,
              after: { ...row, importJobId: job.id, rowNumber: candidate.rowNumber },
            });
          } else if (result.action === 'update' && existing) {
            const changes = {
              siteId: mapping.siteId,
              fieldValues: candidate.fieldValues,
              ...(mapping.location.length && candidate.locationPath.length
                ? { locationId: locationIdOf(candidate.locationPath) }
                : {}),
              ...(mapping.qrCode !== null && candidate.qrCode ? { qrCode: candidate.qrCode } : {}),
              ...(mapping.designation !== null && candidate.designation
                ? designationOf(candidate.designation)
                : {}),
              ...(mapping.nextInspectionDate !== null && candidate.nextInspectionDate
                ? { nextInspectionDate: candidate.nextInspectionDate }
                : {}),
            };
            await tx
              .update(item)
              .set({ ...changes, version: existing.version + 1, updatedAt: now })
              .where(eq(item.id, existing.id));
            audits.push({
              id: newId(),
              organizationId: auth.organizationId,
              actorUserId: auth.userId,
              action: 'item.import_update',
              entityType: 'item',
              entityId: existing.id,
              before: JSON.parse(JSON.stringify(existing)),
              after: { ...changes, importJobId: job.id, rowNumber: candidate.rowNumber },
            });
            updated++;
          }
        }
        for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
          await tx.insert(item).values(inserts.slice(i, i + INSERT_CHUNK));
        }
        for (let i = 0; i < audits.length; i += INSERT_CHUNK) {
          await tx.insert(auditLog).values(audits.slice(i, i + INSERT_CHUNK));
        }

        const result: ImportResult = {
          created: inserts.length,
          updated,
          skipped: summary.skip + summary.error,
          locationsCreated,
        };
        await tx
          .update(importJob)
          .set({ status: 'committed', mapping, result, committedAt: now })
          .where(eq(importJob.id, job.id));
        await tx
          .insert(importMapping)
          .values({
            organizationId: auth.organizationId,
            equipmentTypeId: mapping.equipmentTypeId,
            headers: mappingHeaders(mapping, job.headers),
            values: { replacements: mapping.replacements, defaults: mapping.defaults },
          })
          .onConflictDoUpdate({
            target: [importMapping.organizationId, importMapping.equipmentTypeId],
            set: {
              headers: mappingHeaders(mapping, job.headers),
              values: { replacements: mapping.replacements, defaults: mapping.defaults },
              updatedAt: now,
            },
          });
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'import.commit',
          entityType: 'import_job',
          entityId: job.id,
          after: {
            fileName: job.fileName,
            siteId: mapping.siteId,
            equipmentTypeId: mapping.equipmentTypeId,
            ...result,
          },
        });
        return result;
      });
    },
  };
}

export type ImportsService = ReturnType<typeof createImportsService>;
