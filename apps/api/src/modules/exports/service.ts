import {
  LOCATION_SEPARATOR,
  formatDate,
  formatDateTime,
  exportColumns,
  exportRow,
  fileNamePart,
  outcomeLabel,
  photoCaption,
  photoFileName,
  sheetName,
  toCsv,
  type ExportType,
  type Inspection,
  type InspectionItem,
} from '@revize/shared';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { AuthContext } from '../../auth/context.js';
import type { Db } from '../../db/client.js';
import { appUser, equipmentType, inspectionResult, photo } from '../../db/schema.js';
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
  /** The item for defect photos, null for photos of the inspection as a whole. */
  item: InspectionItem | null;
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
          or(eq(photo.inspectionId, inspectionId), eq(inspectionResult.inspectionId, inspectionId)),
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

  return {
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
          by.set(outcomeLabel(i.result), (by.get(outcomeLabel(i.result)) ?? 0) + 1);
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
    async photosZip(
      auth: AuthContext,
      inspectionId: string,
    ): Promise<ExportFile<ReadableStream<Uint8Array>>> {
      const { inspection, types, photos } = await load(auth, inspectionId);
      const org = await organizationOf(db, auth);
      const typeName = (item: InspectionItem) =>
        types.find((t) => t.id === item.equipmentTypeId)?.name ?? '';
      const describe = (p: ExportPhoto) =>
        p.item
          ? photoCaption(p.item, typeName(p.item))
          : `Kontrola ${inspection.siteName}, ${formatDate(inspection.inspectionDate)}`;

      const photoList = () =>
        toCsv([
          [
            'Soubor',
            'Kontrolní číslo',
            'Typ vybavení',
            'Umístění',
            'Výsledek',
            'Popis',
            'Pořízeno',
            'Pořídil',
          ],
          ...photos
            .filter((p) => !missing.has(p.fileName))
            .map((p) => [
              p.fileName,
              p.item?.itemNumber ?? '',
              p.item ? typeName(p.item) : '',
              p.item?.locationPath.join(LOCATION_SEPARATOR) ?? '',
              p.item ? outcomeLabel(p.item.result) : '',
              describe(p),
              formatDateTime(p.takenAt?.toISOString() ?? null),
              p.author ?? '',
            ]),
        ]);
      const add = (zip: Zip, name: string, bytes: Uint8Array) => {
        const entry = new ZipPassThrough(name);
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
          const p = photos[next++];
          if (!p) {
            if (next === photos.length + 1) {
              add(zip, 'fotky.csv', strToU8(photoList()));
              zip.end();
            }
            return;
          }
          if (!(await files.exists(p.storageKey))) {
            missing.add(p.fileName);
            return;
          }
          const original = await files.read(p.storageKey);
          const bytes = await metadata.write(original, p.mimeType, {
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
          add(zip, p.fileName, bytes);
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
