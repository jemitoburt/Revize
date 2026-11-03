import {
  LOCATION_SEPARATOR,
  appendixColumns,
  appendixRow,
  displayFields,
  fileNamePart,
  fillProtocolTemplate,
  formatDate,
  nextInspectionDateOf,
  PROTOCOL_PDF_MARGINS,
  protocolPageFooter,
  protocolPageHeader,
  renderProtocolHtml,
  severityOf,
  type AppendixColumn,
  type ExportType,
  type InspectionItem,
  type ProtocolData,
  type ProtocolItem,
} from '@revize/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AuthContext } from '../../auth/context.js';
import type { Db } from '../../db/client.js';
import { customer, equipmentType, inspectionResult, photo, site } from '../../db/schema.js';
import { AppError } from '../../errors.js';
import type { FileStorage } from '../../infra/file-storage.js';
import type { PdfRenderer } from '../../infra/pdf-renderer.js';
import type { InspectionsService } from '../inspections/service.js';
import { organizationOf, settingsOf } from '../organization/service.js';
import { renderProtocolDocx } from './docx.js';
import { twoPagesPerSheet } from './two-up.js';

/** Item details shown in the protocol table: the first few filled-in fields of the type. */
const DETAIL_FIELDS = 3;

/**
 * How a result appears in the protocol: the traffic light of a defect, or – for a minor defect
 * the technician did not include – just "complies" without the note.
 */
function printedResult(
  result: InspectionItem['result'],
): Pick<ProtocolItem, 'outcome' | 'defectDescription'> {
  if (!result) return { outcome: 'unchecked', defectDescription: null };
  const severity = severityOf(result);
  if (!severity || !result.includeInProtocol) return { outcome: 'ok', defectDescription: null };
  return { outcome: severity, defectDescription: result.defectDescription };
}

const czechDate = (iso: string | null) => formatDate(iso);

/** The equipment list with the chosen columns (unknown keys are ignored). */
function appendixOf(
  types: ExportType[],
  items: InspectionItem[],
  keys: readonly string[],
): ProtocolData['appendix'] {
  const available = appendixColumns(types);
  const chosen = keys
    .map((key) => available.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (!chosen.length) return null;
  return {
    columns: chosen.map((c) => c.label),
    rows: items.map((i) =>
      appendixRow(
        chosen.map((c) => c.key),
        types,
        i,
      ),
    ),
  };
}

export function createProtocolsService(
  db: Db,
  files: FileStorage,
  inspections: InspectionsService,
  pdf: PdfRenderer | null,
) {
  async function dataUrl(key: string | null, mimeType: string): Promise<string | null> {
    if (!key || !(await files.exists(key))) return null;
    const bytes = await files.read(key);
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  async function build(
    auth: AuthContext,
    inspectionId: string,
    equipmentTypeId?: string,
    /** Columns of the equipment list appended for the customer (none = no appendix). */
    columns: readonly string[] = [],
  ): Promise<ProtocolData> {
    const inspection = await inspections.get(auth, inspectionId);
    // A protocol of one equipment type contains only its items and its protocol text.
    const items = (await inspections.items(auth, inspectionId)).filter(
      (i) => !equipmentTypeId || i.equipmentTypeId === equipmentTypeId,
    );
    const org = await organizationOf(db, auth);
    const settings = settingsOf(org);
    const [[customerRow], [siteRow]] = await Promise.all([
      db.select().from(customer).where(eq(customer.id, inspection.customerId)),
      db.select().from(site).where(eq(site.id, inspection.siteId)),
    ]);
    const typeIds = [...new Set(items.map((i) => i.equipmentTypeId))];
    const types = typeIds.length
      ? await db.select().from(equipmentType).where(inArray(equipmentType.id, typeIds))
      : [];

    // Thumbnails of defect photos (by item) and of the inspection as a whole.
    const resultPhotos = await db
      .select({ itemId: inspectionResult.itemId, key: photo.thumbnailKey })
      .from(photo)
      .innerJoin(inspectionResult, eq(inspectionResult.id, photo.inspectionResultId))
      .where(and(eq(inspectionResult.inspectionId, inspectionId), isNotNull(photo.thumbnailKey)))
      .orderBy(photo.createdAt);
    const photosByItem = new Map<string, string[]>();
    for (const p of resultPhotos) {
      const url = await dataUrl(p.key, 'image/jpeg');
      if (url) photosByItem.set(p.itemId, [...(photosByItem.get(p.itemId) ?? []), url]);
    }
    const overview = await db
      .select({ key: photo.thumbnailKey })
      .from(photo)
      .where(eq(photo.inspectionId, inspectionId))
      .orderBy(photo.createdAt);
    const overviewPhotos = (
      await Promise.all(overview.map((p) => dataUrl(p.key, 'image/jpeg')))
    ).filter((u): u is string => u !== null);

    const inspectors = inspection.inspectors.map((i) => i.displayName);
    const nextDates: string[] = [];
    const sections = types
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
      .map((type) => {
        const next =
          inspection.nextInspectionDate ??
          nextInspectionDateOf(inspection.inspectionDate, type.defaultIntervalMonths, null);
        nextDates.push(next);
        const text = fillProtocolTemplate(type.protocolTemplate, {
          firma: org.name,
          zakaznik: inspection.customerName,
          provozovna: inspection.siteName,
          datum_kontroly: czechDate(inspection.inspectionDate),
          technik: inspectors.join(', '),
          datum_pristi_kontroly: czechDate(next),
        });
        const rows: ProtocolItem[] = items
          .filter((i) => i.equipmentTypeId === type.id)
          .map((i) => ({
            itemNumber: i.itemNumber,
            designation: i.designation,
            location: i.locationPath.join(LOCATION_SEPARATOR),
            details: displayFields(type.fieldDefinitions, i.fieldValues)
              .slice(0, DETAIL_FIELDS)
              .map((f) => f.value)
              .join(' · '),
            ...printedResult(i.result),
            photos: i.result?.includeInProtocol === false ? [] : (photosByItem.get(i.id) ?? []),
          }));
        return { typeName: type.name, text, items: rows };
      });

    return {
      number: `${inspection.inspectionDate}/${inspection.id.slice(-8)}`,
      final: inspection.status === 'closed',
      company: {
        name: org.name,
        companyId: settings.companyId,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        web: settings.web,
        logo: await dataUrl(org.logoKey, org.logoMimeType ?? 'image/png'),
        footer: settings.protocolFooter,
        certification: settings.certification,
        issueDate: settings.protocolIssueDate,
        version: settings.protocolVersion,
        pageFooter: settings.pageFooter,
      },
      customer: {
        name: inspection.customerName,
        companyId: customerRow?.companyId ?? null,
        address: customerRow?.address ?? null,
      },
      site: { name: inspection.siteName, address: siteRow?.address ?? null },
      inspectionDate: inspection.inspectionDate,
      // Before closing: the date closing would set (the earliest of the types' intervals).
      nextInspectionDate: inspection.nextInspectionDate ?? nextDates.sort()[0] ?? null,
      inspectors,
      leadInspector: inspection.leadInspectorName,
      note: inspection.note,
      sections,
      overviewPhotos,
      appendix: appendixOf(types, items, columns),
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    async html(auth: AuthContext, inspectionId: string, options: ProtocolOptions = {}) {
      return renderProtocolHtml(
        await build(auth, inspectionId, options.equipmentTypeId, options.columns),
      );
    },

    /** `twoUp`: two A4 pages side by side on each landscape A4 sheet. */
    async pdf(
      auth: AuthContext,
      inspectionId: string,
      options: ProtocolOptions & { twoUp?: boolean } = {},
    ): Promise<{ data: Uint8Array; fileName: string }> {
      if (!pdf) {
        throw new AppError(501, 'pdf_unavailable', 'PDF se zde nevytváří, použijte tisk náhledu.');
      }
      const data = await build(auth, inspectionId, options.equipmentTypeId, options.columns);
      const bytes = await pdf.render(renderProtocolHtml(data, { pageFrame: false }), {
        header: protocolPageHeader(data),
        footer: protocolPageFooter(data),
        margin: PROTOCOL_PDF_MARGINS,
      });
      const slug = fileNamePart(data.site.name);
      return {
        data: options.twoUp ? await twoPagesPerSheet(bytes) : bytes,
        fileName: `protokol-${slug}-${data.inspectionDate}${options.twoUp ? '-2-na-list' : ''}.pdf`,
      };
    },

    /** The protocol as an editable Word document (works in the browser demo too). */
    async docx(
      auth: AuthContext,
      inspectionId: string,
      options: ProtocolOptions = {},
    ): Promise<{ data: Uint8Array; fileName: string }> {
      const data = await build(auth, inspectionId, options.equipmentTypeId, options.columns);
      return {
        data: await renderProtocolDocx(data),
        fileName: `protokol-${fileNamePart(data.site.name)}-${data.inspectionDate}.docx`,
      };
    },

    /** Columns that can be chosen for the appendix (fixed ones and the types' fields). */
    async columns(auth: AuthContext, inspectionId: string): Promise<AppendixColumn[]> {
      const items = await inspections.items(auth, inspectionId);
      const typeIds = [...new Set(items.map((i) => i.equipmentTypeId))];
      const types = typeIds.length
        ? await db.select().from(equipmentType).where(inArray(equipmentType.id, typeIds))
        : [];
      return appendixColumns(types.sort((a, b) => a.name.localeCompare(b.name, 'cs')));
    },
  };
}

/** Options of a protocol: one equipment type only, columns of the appendix. */
export interface ProtocolOptions {
  equipmentTypeId?: string;
  columns?: string[];
}

export type ProtocolsService = ReturnType<typeof createProtocolsService>;
