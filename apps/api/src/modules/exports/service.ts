import {
  LOCATION_SEPARATOR,
  formatDate,
  formatDateTime,
  exportColumns,
  exportRow,
  databaseColumns,
  databaseRow,
  fileNamePart,
  HISTORY_COLUMNS,
  historyRow,
  outcomeLabel,
  photoCaption,
  photoFileName,
  sheetName,
  toCsv,
  type DatabaseItem,
  type ExportType,
  type HistoryRow,
  type Inspection,
  type InspectionItem,
} from '@revize/shared';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import type { AuthContext } from '../../auth/context.js';
import type { Db } from '../../db/client.js';
import {
  appUser,
  customer,
  equipmentType,
  inspection,
  inspectionResult,
  item,
  location,
  photo,
  site,
} from '../../db/schema.js';
import { locationNames, pathNamesOf } from '../locations/service.js';
import type { FileStorage } from '../../infra/file-storage.js';
import type { MetadataWriter } from '../../infra/metadata-writer.js';
import type { InspectionsService } from '../inspections/service.js';
import { organizationOf } from '../organization/service.js';

interface ExportPhoto {
  fileName: string;
  storageKey: string;
  mimeType: string;
  takenAt: Date | null;
  author: string | null;
  /** The item for defect and item photos, null for photos of the inspection as a whole. */
  item: InspectionItem | null;
  /** Item photos (nameplate, overview) are not about the defect. */
  itemPhoto?: boolean;
}

/** Filters of the database export (empty = everything). */
export interface DatabaseQuery {
  customerId?: string;
  siteId?: string;
  equipmentTypeId?: string;
  includeRetired?: boolean;
}

export interface ExportFile<T> {
  data: T;
  fileName: string;
  contentType: string;
}

export function createExportsService(
  db: Db,
  files: FileStorage,
  inspections: InspectionsService,
  metadata: MetadataWriter,
) {
  /** Inspection, its items (sorted like the field list), their types and named photos. */
  async function load(auth: AuthContext, inspectionId: string) {
    const inspection = await inspections.get(auth, inspectionId);
    const items = await inspections.items(auth, inspectionId);
    const typeIds = [...new Set(items.map((i) => i.equipmentTypeId))];
    const types: ExportType[] = typeIds.length
      ? (
          await db
            .select({
              id: equipmentType.id,
              name: equipmentType.name,
              fieldDefinitions: equipmentType.fieldDefinitions,
            })
            .from(equipmentType)
            .where(inArray(equipmentType.id, typeIds))
        ).sort((a, b) => a.name.localeCompare(b.name, 'cs'))
      : [];

    const rows = await db
      .select({
        itemId: inspectionResult.itemId,
        resultInspectionId: inspectionResult.inspectionId,
        inspectionId: photo.inspectionId,
        ownItemId: photo.itemId,
        storageKey: photo.storageKey,
        mimeType: photo.mimeType,
        takenAt: photo.takenAt,
        author: appUser.displayName,
      })
      .from(photo)
      .leftJoin(inspectionResult, eq(inspectionResult.id, photo.inspectionResultId))
      .leftJoin(appUser, eq(appUser.id, photo.createdBy))
      .where(
        and(
          eq(photo.organizationId, auth.organizationId),
          or(
            eq(photo.inspectionId, inspectionId),
            eq(inspectionResult.inspectionId, inspectionId),
            // Photos of the items themselves (nameplate, overview) go into the ZIP too.
            items.length
              ? inArray(
                  photo.itemId,
                  items.map((i) => i.id),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(asc(photo.createdAt), asc(photo.id));
    const counters = new Map<string, number>();
    const photos: ExportPhoto[] = [];
    const nameOf = (prefix: string, mimeType: string) => {
      const index = counters.get(prefix) ?? 0;
      counters.set(prefix, index + 1);
      return photoFileName(prefix, index, mimeType);
    };
    // Defect photos in the order of the item list, then the photos of the inspection.
    for (const item of items) {
      for (const p of rows) {
        if (p.resultInspectionId !== inspectionId || p.itemId !== item.id) continue;
        photos.push({ ...p, fileName: nameOf(item.itemNumber, p.mimeType), item });
      }
      for (const p of rows) {
        if (p.ownItemId !== item.id) continue;
        photos.push({
          ...p,
          fileName: nameOf(`${item.itemNumber}_artikl`, p.mimeType),
          item,
          itemPhoto: true,
        });
      }
    }
    for (const p of rows) {
      if (p.inspectionId !== inspectionId) continue;
      photos.push({ ...p, fileName: nameOf('kontrola', p.mimeType), item: null });
    }
    const photosOf = (itemId: string) =>
      photos.filter((p) => p.item?.id === itemId).map((p) => p.fileName);
    return { inspection, items, types, photos, photosOf };
  }

  const baseName = (inspection: Inspection) =>
    `kontrola-${fileNamePart(inspection.siteName)}-${inspection.inspectionDate}`;

  const headerRows = (inspection: Inspection) => [
    ['Zákazník', inspection.customerName],
    ['Provozovna', inspection.siteName],
    ['Datum kontroly', formatDate(inspection.inspectionDate)],
    ['Technici', inspection.inspectors.map((i) => i.displayName).join(', ')],
    ['Stav', inspection.status === 'closed' ? 'uzavřená' : 'otevřená'],
    ['Zkontrolováno', `${inspection.progress.checked} / ${inspection.progress.total}` as string],
  ];

  /** Items of the records (filtered) with their type and the result of their last inspection. */
  async function loadDatabase(auth: AuthContext, query: DatabaseQuery) {
    const filters: SQL[] = [eq(item.organizationId, auth.organizationId)];
    if (query.customerId) filters.push(eq(item.customerId, query.customerId));
    if (query.siteId) filters.push(eq(item.siteId, query.siteId));
    if (query.equipmentTypeId) filters.push(eq(item.equipmentTypeId, query.equipmentTypeId));
    if (!query.includeRetired) filters.push(isNull(item.retiredAt));
    const rows = await db
      .select({
        item,
        customerName: customer.name,
        siteName: site.name,
        pathIds: location.pathIds,
        sortPath: location.sortPath,
      })
      .from(item)
      .innerJoin(customer, eq(customer.id, item.customerId))
      .innerJoin(site, eq(site.id, item.siteId))
      .leftJoin(location, eq(location.id, item.locationId))
      .where(and(...filters))
      .orderBy(
        asc(customer.name),
        asc(site.name),
        sql`${location.sortPath} asc nulls last`,
        sql`length(${item.itemNumber})`,
        asc(item.itemNumber),
      );
    const names = await locationNames(
      db,
      rows.flatMap((r) => r.pathIds ?? []),
    );
    // The last result of every item (latest inspection date, then latest record).
    const ids = rows.map((r) => r.item.id);
    const last = new Map<string, DatabaseItem['lastInspection']>();
    for (let i = 0; i < ids.length; i += 1000) {
      const results = await db
        .selectDistinctOn([inspectionResult.itemId], {
          itemId: inspectionResult.itemId,
          date: inspection.inspectionDate,
          outcome: inspectionResult.outcome,
          takenOutOfService: inspectionResult.takenOutOfService,
          severity: inspectionResult.severity,
          defectDescription: inspectionResult.defectDescription,
        })
        .from(inspectionResult)
        .innerJoin(inspection, eq(inspection.id, inspectionResult.inspectionId))
        .where(inArray(inspectionResult.itemId, ids.slice(i, i + 1000)))
        .orderBy(
          inspectionResult.itemId,
          desc(inspection.inspectionDate),
          desc(inspectionResult.recordedAt),
        );
      for (const r of results) {
        last.set(r.itemId, {
          date: r.date,
          result: {
            outcome: r.outcome as 'ok' | 'defect',
            takenOutOfService: r.takenOutOfService,
            severity: r.severity as 'green' | 'amber' | 'red' | null,
            defectDescription: r.defectDescription,
          },
        });
      }
    }
    const typeIds = [...new Set(rows.map((r) => r.item.equipmentTypeId))];
    const types: ExportType[] = typeIds.length
      ? (
          await db
            .select({
              id: equipmentType.id,
              name: equipmentType.name,
              fieldDefinitions: equipmentType.fieldDefinitions,
              riskLevels: equipmentType.riskLevels,
            })
            .from(equipmentType)
            .where(inArray(equipmentType.id, typeIds))
        ).sort((a, b) => a.name.localeCompare(b.name, 'cs'))
      : [];
    const items: DatabaseItem[] = rows.map((r) => ({
      customerName: r.customerName,
      siteName: r.siteName,
      locationPath: r.pathIds ? pathNamesOf(r.pathIds, names) : [],
      itemNumber: r.item.itemNumber,
      designation: r.item.designation,
      qrCode: r.item.qrCode,
      equipmentTypeId: r.item.equipmentTypeId,
      fieldValues: r.item.fieldValues,
      status: r.item.status as DatabaseItem['status'],
      retired: r.item.retiredAt !== null,
      nextInspectionDate: r.item.nextInspectionDate,
      lastInspection: last.get(r.item.id) ?? null,
    }));
    return { items, types, rows, names };
  }

  /** Every result of the exported items (newest inspection first per item): the history. */
  async function loadHistory(auth: AuthContext, query: DatabaseQuery) {
    const { types, rows, names } = await loadDatabase(auth, query);
    const byId = new Map(rows.map((r) => [r.item.id, r]));
    const history: HistoryRow[] = [];
    const ids = rows.map((r) => r.item.id);
    for (let i = 0; i < ids.length; i += 1000) {
      const results = await db
        .select({
          result: inspectionResult,
          date: inspection.inspectionDate,
          status: inspection.status,
          recordedByName: appUser.displayName,
          photos: sql<number>`(select count(*)::int from photo p where p.inspection_result_id = "inspection_result"."id")`,
        })
        .from(inspectionResult)
        .innerJoin(inspection, eq(inspection.id, inspectionResult.inspectionId))
        .innerJoin(appUser, eq(appUser.id, inspectionResult.recordedBy))
        .where(
          and(
            eq(inspectionResult.organizationId, auth.organizationId),
            inArray(inspectionResult.itemId, ids.slice(i, i + 1000)),
          ),
        );
      for (const r of results) {
        const owner = byId.get(r.result.itemId)!;
        history.push({
          customerName: owner.customerName,
          siteName: owner.siteName,
          itemNumber: owner.item.itemNumber,
          designation: owner.item.designation,
          equipmentTypeId: owner.item.equipmentTypeId,
          locationPath: owner.pathIds ? pathNamesOf(owner.pathIds, names) : [],
          inspectionDate: r.date,
          inspectionClosed: r.status === 'closed',
          result: {
            outcome: r.result.outcome as 'ok' | 'defect',
            takenOutOfService: r.result.takenOutOfService,
            severity: r.result.severity as HistoryRow['result']['severity'],
            defectDescription: r.result.defectDescription,
            includeInProtocol: r.result.includeInProtocol,
          },
          recordedByName: r.recordedByName,
          recordedAt: r.result.recordedAt.toISOString(),
          photoCount: r.photos,
        });
      }
    }
    // In the order of the records, the newest inspection first.
    const order = new Map(rows.map((r, index) => [r.item.itemNumber + '|' + r.siteName, index]));
    history.sort(
      (a, b) =>
        (order.get(a.itemNumber + '|' + a.siteName) ?? 0) -
          (order.get(b.itemNumber + '|' + b.siteName) ?? 0) ||
        b.inspectionDate.localeCompare(a.inspectionDate),
    );
    return { history, types };
  }

  const databaseName = () => `evidence-${new Date().toISOString().slice(0, 10)}`;

  return {
    /** The records (all or filtered) as one CSV with the union of the types' fields. */
    async databaseCsv(auth: AuthContext, query: DatabaseQuery): Promise<ExportFile<string>> {
      const { items, types } = await loadDatabase(auth, query);
      return {
        data: toCsv([
          databaseColumns(types).map((c) => c.header),
          ...items.map((i) => databaseRow(types, i)),
        ]),
        fileName: `${databaseName()}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    },

    /** The records as XLSX: a sheet with everything and one sheet per equipment type. */
    /** Every inspection result of the records as CSV (the history sheet of the XLSX). */
    async historyCsv(auth: AuthContext, query: DatabaseQuery): Promise<ExportFile<string>> {
      const { history, types } = await loadHistory(auth, query);
      return {
        data: toCsv([
          HISTORY_COLUMNS.map((c) => c.header),
          ...history.map((h) => historyRow(types, h)),
        ]),
        fileName: `historie-kontrol-${new Date().toISOString().slice(0, 10)}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    },

    async databaseXlsx(auth: AuthContext, query: DatabaseQuery): Promise<ExportFile<Uint8Array>> {
      const { items, types } = await loadDatabase(auth, query);
      const org = await organizationOf(db, auth);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = org.name;
      const sheet = (name: string, sheetTypes: ExportType[], rows: DatabaseItem[]) => {
        const columns = databaseColumns(sheetTypes);
        const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
        ws.getRow(1).font = { bold: true };
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        for (const i of rows) ws.addRow(databaseRow(sheetTypes, i));
      };
      sheet('Vše', types, items);
      const taken = ['Vše', 'Historie kontrol'];
      for (const type of types) {
        const name = sheetName(type.name, taken);
        taken.push(name);
        sheet(
          name,
          [type],
          items.filter((i) => i.equipmentTypeId === type.id),
        );
      }
      // Every inspection result of these items (the whole history).
      const { history } = await loadHistory(auth, query);
      const hs = workbook.addWorksheet('Historie kontrol', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      hs.columns = HISTORY_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
      hs.getRow(1).font = { bold: true };
      hs.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: HISTORY_COLUMNS.length },
      };
      for (const h of history) hs.addRow(historyRow(types, h));
      return {
        data: new Uint8Array(await workbook.xlsx.writeBuffer()),
        fileName: `${databaseName()}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    },

    /** All results in one table (union of the types' fields). */
    async csv(auth: AuthContext, inspectionId: string): Promise<ExportFile<string>> {
      const { inspection, items, types, photosOf } = await load(auth, inspectionId);
      const columns = exportColumns(types);
      const rows = [
        columns.map((c) => c.header),
        ...items.map((i) => exportRow(types, i, photosOf(i.id))),
      ];
      return {
        data: toCsv(rows),
        fileName: `${baseName(inspection)}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    },

    /** Summary sheet and one sheet per equipment type with its own field columns. */
    async xlsx(auth: AuthContext, inspectionId: string): Promise<ExportFile<Uint8Array>> {
      const { inspection, items, types, photosOf } = await load(auth, inspectionId);
      const org = await organizationOf(db, auth);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = org.name;
      const summary = workbook.addWorksheet('Kontrola');
      summary.columns = [{ width: 18 }, { width: 50 }];
      for (const row of headerRows(inspection))
        summary.addRow(row).getCell(1).font = { bold: true };
      summary.addRow([]);
      const counts = summary.addRow(['Typ vybavení', 'Artiklů / výsledek']);
      counts.font = { bold: true };
      for (const type of types) {
        const own = items.filter((i) => i.equipmentTypeId === type.id);
        const by = new Map<string, number>();
        for (const i of own)
          by.set(
            outcomeLabel(i.result, type.riskLevels),
            (by.get(outcomeLabel(i.result, type.riskLevels)) ?? 0) + 1,
          );
        summary.addRow([
          type.name,
          `${own.length}: ${[...by].map(([label, n]) => `${label} ${n}`).join(', ')}`,
        ]);
      }

      const taken = ['Kontrola'];
      for (const type of types) {
        const name = sheetName(type.name, taken);
        taken.push(name);
        const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        const columns = exportColumns([type]);
        sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }));
        sheet.getRow(1).font = { bold: true };
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        for (const item of items.filter((i) => i.equipmentTypeId === type.id)) {
          sheet.addRow(exportRow([type], item, photosOf(item.id)));
        }
      }
      return {
        data: new Uint8Array(await workbook.xlsx.writeBuffer()),
        fileName: `${baseName(inspection)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    },

    /**
     * Photos of the inspection as a ZIP, streamed: `12345_01.jpg` for defect photos,
     * `kontrola_01.jpg` for the inspection, metadata written into each photo, and
     * `fotky.csv` with the same descriptions. Photos are stored, not compressed (JPEG).
     */
    /** What the photo ZIP will contain (shown in the Export menu, for checking). */
    async photosList(
      auth: AuthContext,
      inspectionId: string,
    ): Promise<{ files: { fileName: string; exists: boolean }[] }> {
      const { photos } = await load(auth, inspectionId);
      return {
        files: await Promise.all(
          photos.map(async (p) => ({
            fileName: p.fileName,
            exists: await files.exists(p.storageKey),
          })),
        ),
      };
    },

    async photosZip(
      auth: AuthContext,
      inspectionId: string,
    ): Promise<ExportFile<ReadableStream<Uint8Array>>> {
      const { inspection, types, photos } = await load(auth, inspectionId);
      console.info(`photos.zip: inspection ${inspectionId}: ${photos.length} photos`);
      const org = await organizationOf(db, auth);
      const typeName = (item: InspectionItem) =>
        types.find((t) => t.id === item.equipmentTypeId)?.name ?? '';
      const riskLevels = (item: InspectionItem) =>
        types.find((t) => t.id === item.equipmentTypeId)?.riskLevels ?? true;
      const describe = (p: ExportPhoto) =>
        p.item && p.itemPhoto
          ? [`Fotka artiklu – číslo TZ ${p.item.itemNumber}`, p.item.designation, typeName(p.item)]
              .filter(Boolean)
              .join(' – ')
          : p.item
            ? photoCaption(p.item, typeName(p.item), riskLevels(p.item))
            : `Kontrola ${inspection.siteName}, ${formatDate(inspection.inspectionDate)}`;

      const photoList = () =>
        toCsv([
          [
            'Soubor',
            'Číslo TZ',
            'Označení',
            'Typ vybavení',
            'Umístění',
            'Výsledek',
            'Popis',
            'Pořízeno',
            'Pořídil',
          ],
          // A photo whose file is not in the storage stays in the list, marked, so it is not
          // silently lost.
          ...photos.map((p) => [
            missing.has(p.fileName) ? `${p.fileName} (soubor chybí na serveru)` : p.fileName,
            p.item?.itemNumber ?? '',
            p.item?.designation ?? '',
            p.item ? typeName(p.item) : '',
            p.item?.locationPath.join(LOCATION_SEPARATOR) ?? '',
            p.item ? outcomeLabel(p.item.result, riskLevels(p.item)) : '',
            describe(p),
            formatDateTime(p.takenAt?.toISOString() ?? null),
            p.author ?? '',
          ]),
        ]);
      const add = (zip: Zip, name: string, bytes: Uint8Array) => {
        // Deflate, not "stored": a streamed entry has its sizes only after the data, which the
        // macOS Archive Utility cannot handle for stored entries (it extracts empty files).
        // Level 0 for JPEGs (already compressed), so it costs nothing.
        const entry = new ZipDeflate(name, { level: name.endsWith('.csv') ? 6 : 0 });
        zip.add(entry);
        entry.push(bytes, true);
      };

      let zip: Zip;
      let next = 0;
      const missing = new Set<string>();
      // One photo per pull: the archive follows the download speed and only one original is
      // in memory at a time.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          zip = new Zip((error, chunk, final) => {
            if (error) return controller.error(error);
            controller.enqueue(chunk);
            if (final) controller.close();
          });
        },
        async pull() {
          // Each pull adds one entry (or ends the archive): a pull that adds nothing would leave
          // the download waiting, so a skipped photo goes straight on to the next one.
          for (;;) {
            const p = photos[next++];
            if (!p) {
              if (next === photos.length + 1) {
                add(zip, 'fotky.csv', strToU8(photoList()));
                zip.end();
              }
              return;
            }
            if (!(await files.exists(p.storageKey))) {
              console.warn(`photos.zip: photo file missing in storage: ${p.storageKey}`);
              missing.add(p.fileName);
              continue;
            }
            let original: Uint8Array;
            try {
              original = await files.read(p.storageKey);
            } catch (error) {
              console.warn(`photos.zip: cannot read ${p.storageKey}`, error);
              missing.add(p.fileName);
              continue;
            }
            // The metadata are a bonus: if ExifTool fails, the photo goes in as it is, so one
            // photo never breaks the whole archive.
            let bytes = original;
            try {
              bytes = await metadata.write(original, p.mimeType, {
                title: p.item ? p.item.itemNumber : `Kontrola ${inspection.siteName}`,
                description: describe(p),
                keywords: [
                  ...(p.item ? [p.item.itemNumber, typeName(p.item)] : []),
                  inspection.customerName,
                  inspection.siteName,
                ].filter(Boolean),
                author: p.author,
                copyright: org.name,
                location: p.item ? p.item.locationPath.join(LOCATION_SEPARATOR) : '',
                takenAt: p.takenAt,
              });
            } catch (error) {
              console.warn(`photos.zip: metadata not written for ${p.storageKey}`, error);
            }
            add(zip, p.fileName, bytes);
            return;
          }
        },
      });
      return {
        data: stream,
        fileName: `fotky-${baseName(inspection).replace(/^kontrola-/, '')}.zip`,
        contentType: 'application/zip',
      };
    },
  };
}

export type ExportsService = ReturnType<typeof createExportsService>;
