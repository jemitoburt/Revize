import {
  EQUIPMENT_TYPE_PRESETS,
  convertItemValues,
  equipmentTypePreset,
  fieldDefinitionsSchema,
  kindChanges,
  newId,
  planTypeMerge,
  summarizeConversion,
  type MergePlan,
  type MergeTypesRequest,
  type ConversionSummary,
  type EquipmentType,
  type FieldDefinition,
  type createEquipmentTypeSchema,
  type updateEquipmentTypeSchema,
} from '@revize/shared';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  auditLog,
  equipmentType,
  importMapping,
  inspectionTypeScope,
  item,
} from '../../db/schema.js';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { AppError, notFound, validationError, versionConflict, type Issue } from '../../errors.js';
import { recordAudit } from '../audit/service.js';

type Row = typeof equipmentType.$inferSelect;

// Qualified names on purpose, see customers/service.ts.
const itemCount = sql<number>`(select count(*)::int from item i where i.equipment_type_id = "equipment_type"."id" and i.retired_at is null)`;

function toDto(row: Row, count: number): EquipmentType {
  return {
    id: row.id,
    name: row.name,
    fieldDefinitions: row.fieldDefinitions,
    defaultIntervalMonths: row.defaultIntervalMonths,
    protocolTemplate: row.protocolTemplate,
    riskLevels: row.riskLevels,
    schemaVersion: row.schemaVersion,
    archived: row.archivedAt !== null,
    itemCount: count,
    version: row.version,
  };
}

/**
 * Stored item values must stay readable when a type changes (ADR-0006): field keys can only be
 * archived, never removed. A changed kind converts the stored values (`convertItemValues`).
 */
export function checkDefinitionChange(
  before: FieldDefinition[],
  after: FieldDefinition[],
): Issue[] {
  const issues: Issue[] = [];
  const next = new Map(after.map((field, index) => [field.key, { field, index }]));
  for (const old of before) {
    const found = next.get(old.key);
    if (!found) {
      issues.push({
        path: ['fieldDefinitions'],
        message: `Pole „${old.label}“ nelze odstranit – data artiklů by se ztratila. Archivujte ho.`,
      });
    }
  }
  return issues;
}

const nameTaken = () =>
  new AppError(409, 'name_taken', 'Typ s tímto názvem už existuje.', [
    { path: ['name'], message: 'Název už je použit' },
  ]);

/** The target and the merged types (all of the organization, not archived targets only). */
async function mergeRows(tx: DbOrTx, auth: AuthContext, input: MergeTypesRequest) {
  const ids = [input.targetId, ...input.sourceIds];
  if (new Set(ids).size !== ids.length) {
    throw validationError([
      { path: ['sourceIds'], message: 'Cílový typ nemůže být mezi slučovanými' },
    ]);
  }
  const rows = await tx
    .select()
    .from(equipmentType)
    .where(
      and(eq(equipmentType.organizationId, auth.organizationId), inArray(equipmentType.id, ids)),
    );
  const target = rows.find((r) => r.id === input.targetId);
  if (!target || rows.length !== ids.length) throw notFound('Typ vybavení neexistuje.');
  return { target, sources: input.sourceIds.map((id) => rows.find((r) => r.id === id)!) };
}

export function createEquipmentTypesService(db: Db) {
  async function getRow(tx: DbOrTx, auth: AuthContext, id: string) {
    const [row] = await tx
      .select()
      .from(equipmentType)
      .where(and(eq(equipmentType.organizationId, auth.organizationId), eq(equipmentType.id, id)));
    if (!row) throw notFound('Typ vybavení neexistuje.');
    return row;
  }

  async function nameExists(tx: DbOrTx, auth: AuthContext, name: string, exceptId?: string) {
    const [row] = await tx
      .select({ id: equipmentType.id })
      .from(equipmentType)
      .where(
        and(
          eq(equipmentType.organizationId, auth.organizationId),
          sql`lower(${equipmentType.name}) = lower(${name})`,
          exceptId ? ne(equipmentType.id, exceptId) : undefined,
        ),
      );
    return row !== undefined;
  }

  return {
    /** What saving these definitions would do to the stored values of changed-kind fields. */
    /** What merging types would do (nothing is saved). */
    async mergePreview(auth: AuthContext, input: MergeTypesRequest): Promise<MergePlan> {
      const { target, sources } = await mergeRows(db, auth, input);
      const plan = planTypeMerge(target, sources, input);
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(item)
        .where(
          and(
            eq(item.organizationId, auth.organizationId),
            inArray(
              item.equipmentTypeId,
              sources.map((s) => s.id),
            ),
          ),
        );
      return {
        items: count?.n ?? 0,
        addedFields: plan.addedFields,
        conflicts: plan.conflicts,
        kindValues: plan.kindValues,
      };
    },

    /**
     * Merges types into the target (audited): the target keeps its settings and gets the missing
     * fields, the items (and inspections limited to the merged types) move to it, the former type
     * is kept in the kind field, the merged types are archived.
     */
    async merge(auth: AuthContext, input: MergeTypesRequest): Promise<EquipmentType> {
      const id = await db.transaction(async (tx) => {
        const { target, sources } = await mergeRows(tx, auth, input);
        const plan = planTypeMerge(target, sources, input);
        const name = input.name || target.name;
        if (name !== target.name && (await nameExists(tx, auth, name, target.id))) {
          throw nameTaken();
        }
        await tx
          .update(equipmentType)
          .set({
            name,
            fieldDefinitions: plan.fieldDefinitions,
            schemaVersion: target.schemaVersion + 1,
            version: target.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(equipmentType.id, target.id));
        const sourceIds = sources.map((x) => x.id);
        const key = input.kindField?.key;
        // The former type of every item into the kind field, unless it already has a value.
        for (const t of [target, ...sources]) {
          const value = key ? plan.kindValues[t.name] : undefined;
          await tx
            .update(item)
            .set({
              equipmentTypeId: target.id,
              ...(key && value
                ? {
                    fieldValues: sql`case when coalesce(${item.fieldValues}->>${key}, '') = '' then ${item.fieldValues} || jsonb_build_object(${key}::text, ${value}::text) else ${item.fieldValues} end`,
                  }
                : {}),
              version: sql`${item.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(eq(item.organizationId, auth.organizationId), eq(item.equipmentTypeId, t.id)),
            );
        }
        // Inspections limited to a merged type now cover the target.
        await tx.execute(sql`
          insert into inspection_type_scope (inspection_id, equipment_type_id)
          select distinct s.inspection_id, ${target.id}::uuid from inspection_type_scope s
          where s.equipment_type_id in (${sql.join(
            sourceIds.map((x) => sql`${x}::uuid`),
            sql`, `,
          )})
          on conflict do nothing`);
        await tx
          .delete(inspectionTypeScope)
          .where(inArray(inspectionTypeScope.equipmentTypeId, sourceIds));
        await tx.delete(importMapping).where(inArray(importMapping.equipmentTypeId, sourceIds));
        await tx
          .update(equipmentType)
          .set({
            archivedAt: new Date(),
            updatedAt: new Date(),
            version: sql`${equipmentType.version} + 1`,
          })
          .where(inArray(equipmentType.id, sourceIds));
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'equipment_type.merge',
          entityType: 'equipment_type',
          entityId: target.id,
          before: { target, sources: sources.map((x) => ({ id: x.id, name: x.name })) },
          after: { name, kindValues: plan.kindValues, addedFields: plan.addedFields },
        });
        return target.id;
      });
      return this.get(auth, id);
    },

    async conversionPreview(
      auth: AuthContext,
      id: string,
      definitions: unknown,
    ): Promise<ConversionSummary[]> {
      const current = await getRow(db, auth, id);
      const parsed = fieldDefinitionsSchema.safeParse(definitions);
      if (!parsed.success) {
        throw validationError([{ path: ['fieldDefinitions'], message: 'Neplatná definice polí' }]);
      }
      const items = await db
        .select({ fieldValues: item.fieldValues })
        .from(item)
        .where(eq(item.equipmentTypeId, id));
      return summarizeConversion(
        current.fieldDefinitions,
        parsed.data,
        items.map((i) => i.fieldValues),
      );
    },

    getRow: (auth: AuthContext, id: string) => getRow(db, auth, id),

    presets() {
      return EQUIPMENT_TYPE_PRESETS.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        standards: p.standards,
        defaultIntervalMonths: p.defaultIntervalMonths,
        fieldCount: p.fieldDefinitions.length,
      }));
    },

    async list(auth: AuthContext, includeArchived = false): Promise<EquipmentType[]> {
      const rows = await db
        .select({ row: equipmentType, itemCount })
        .from(equipmentType)
        .where(
          and(
            eq(equipmentType.organizationId, auth.organizationId),
            includeArchived ? undefined : isNull(equipmentType.archivedAt),
          ),
        )
        .orderBy(asc(equipmentType.name));
      return rows.map((r) => toDto(r.row, r.itemCount));
    },

    async get(auth: AuthContext, id: string): Promise<EquipmentType> {
      const [r] = await db
        .select({ row: equipmentType, itemCount })
        .from(equipmentType)
        .where(
          and(eq(equipmentType.organizationId, auth.organizationId), eq(equipmentType.id, id)),
        );
      if (!r) throw notFound('Typ vybavení neexistuje.');
      return toDto(r.row, r.itemCount);
    },

    async create(
      auth: AuthContext,
      input: z.output<typeof createEquipmentTypeSchema>,
    ): Promise<EquipmentType> {
      const id = input.id ?? newId();
      let values: Omit<typeof equipmentType.$inferInsert, 'id' | 'organizationId'>;
      if ('presetKey' in input) {
        const preset = equipmentTypePreset(input.presetKey);
        if (!preset)
          throw validationError([{ path: ['presetKey'], message: 'Neznámý typ z knihovny' }]);
        values = {
          name: input.name ?? preset.name,
          fieldDefinitions: preset.fieldDefinitions,
          defaultIntervalMonths: preset.defaultIntervalMonths,
          protocolTemplate: preset.protocolTemplate,
          riskLevels: preset.riskLevels ?? false,
        };
      } else {
        const { id: _id, ...rest } = input;
        values = rest;
      }

      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(equipmentType).where(eq(equipmentType.id, id));
        if (existing && existing.organizationId === auth.organizationId) return toDto(existing, 0);
        if (await nameExists(tx, auth, values.name)) throw nameTaken();
        const [row] = await tx
          .insert(equipmentType)
          .values({ ...values, id, organizationId: auth.organizationId })
          .returning();
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'equipment_type.create',
          entityType: 'equipment_type',
          entityId: id,
          after: row,
        });
        return toDto(row!, 0);
      });
    },

    async update(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateEquipmentTypeSchema>,
    ): Promise<EquipmentType> {
      await db.transaction(async (tx) => {
        const current = await getRow(tx, auth, id);
        if (current.version !== input.version) throw versionConflict();
        if (input.name && (await nameExists(tx, auth, input.name, id))) throw nameTaken();

        const definitionsChanged =
          input.fieldDefinitions !== undefined &&
          JSON.stringify(input.fieldDefinitions) !== JSON.stringify(current.fieldDefinitions);
        if (definitionsChanged) {
          const issues = checkDefinitionChange(current.fieldDefinitions, input.fieldDefinitions!);
          if (issues.length) throw validationError(issues, issues[0]!.message);
        }

        const { version, archived, ...changes } = input;
        // Changed field kinds: convert the stored values of all items of the type (ADR-0006).
        const converted = definitionsChanged
          ? kindChanges(current.fieldDefinitions, input.fieldDefinitions!)
          : [];
        if (converted.length) {
          const definitions = input.fieldDefinitions!.map((f) => ({ ...f }));
          const items = await tx
            .select({ id: item.id, fieldValues: item.fieldValues, version: item.version })
            .from(item)
            .where(eq(item.equipmentTypeId, id));
          const audits: (typeof auditLog.$inferInsert)[] = [];
          for (const row of items) {
            const done = convertItemValues(converted, definitions, row.fieldValues);
            for (const [key, options] of Object.entries(done.newOptions)) {
              const field = definitions.find((f) => f.key === key)!;
              field.options = [...new Set([...field.options, ...options])];
            }
            if (!done.changed.length) continue;
            await tx
              .update(item)
              .set({ fieldValues: done.values, version: row.version + 1, updatedAt: new Date() })
              .where(eq(item.id, row.id));
            audits.push({
              id: newId(),
              organizationId: auth.organizationId,
              actorUserId: auth.userId,
              action: 'item.field_kind_conversion',
              entityType: 'item',
              entityId: row.id,
              before: { fieldValues: row.fieldValues },
              after: { fieldValues: done.values, changed: done.changed },
            });
          }
          for (let i = 0; i < audits.length; i += 500) {
            await tx.insert(auditLog).values(audits.slice(i, i + 500));
          }
          changes.fieldDefinitions = definitions;
        }
        const [row] = await tx
          .update(equipmentType)
          .set({
            ...changes,
            schemaVersion: definitionsChanged ? current.schemaVersion + 1 : undefined,
            archivedAt:
              archived === undefined
                ? undefined
                : archived
                  ? (current.archivedAt ?? new Date())
                  : null,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(equipmentType.id, id), eq(equipmentType.version, version)))
          .returning();
        if (!row) throw versionConflict();
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: archived === true ? 'equipment_type.archive' : 'equipment_type.update',
          entityType: 'equipment_type',
          entityId: id,
          before: current,
          after: row,
        });
      });
      return this.get(auth, id);
    },
  };
}

export type EquipmentTypesService = ReturnType<typeof createEquipmentTypesService>;
