import {
  LOCATION_SEPARATOR,
  appendixColumns,
  appendixRow,
  DEFAULT_APPENDIX_COLUMNS,
  photoBox,
  protocolDefectGroups,
  protocolLayout,
  displayFields,
  fileNamePart,
  fillProtocolTemplate,
  formatDate,
  certificationLines,
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
import { eq, inArray } from 'drizzle-orm';
import type { AuthContext } from '../../auth/context.js';
import type { Db } from '../../db/client.js';
import {
  appUser,
  customer,
  equipmentType,
  inspection as inspectionTable,
  inspectionResult,
  photo,
  site,
} from '../../db/schema.js';
import { AppError } from '../../errors.js';
import type { FileStorage } from '../../infra/file-storage.js';
import type { ImageProcessor } from '../../infra/image-processor.js';
import type { PdfRenderer } from '../../infra/pdf-renderer.js';
import type { InspectionsService } from '../inspections/service.js';
import { organizationOf, settingsOf } from '../organization/service.js';
import { zipSync } from 'fflate';
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
  riskLevels: boolean,
): Pick<ProtocolItem, 'outcome' | 'defectDescription'> {
  if (!result) return { outcome: 'unchecked', defectDescription: null };
  const severity = severityOf(result);
  if (!severity) return { outcome: 'ok', defectDescription: null };
  // Types without risk levels: a defect preventing safe operation ("unfit") or not ("minor",
  // stored as green); both always printed, with their photos.
  if (!riskLevels) {
    return {
      outcome: severity === 'green' ? 'minor' : 'unfit',
      defectDescription: result.defectDescription,
    };
  }
  if (!result.includeInProtocol) return { outcome: 'ok', defectDescription: null };
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
  // A minor defect left out of the protocol is printed as fit, without its note (as in the
  // protocol table).
  const riskLevelsOf = (i: InspectionItem) =>
    types.find((t) => t.id === i.equipmentTypeId)?.riskLevels ?? true;
  const printed = items.map((i) =>
    i.result && i.result.outcome === 'defect' && !i.result.includeInProtocol && riskLevelsOf(i)
      ? {
          ...i,
          result: { ...i.result, outcome: 'ok' as const, severity: null, defectDescription: null },
        }
      : i,
  );
  return {
    columns: chosen.map((c) => c.label),
    rows: printed.map((i) => ({
      cells: appendixRow(
        chosen.map((c) => c.key),
        types,
        i,
      ),
      // ANO/NE as in the protocol table: yellow and red are not fit for safe operation.
      unsafe:
        i.result !== null &&
        (riskLevelsOf(i)
          ? ['amber', 'red'].includes(severityOf(i.result) ?? '')
          : i.result.outcome === 'defect' && severityOf(i.result) !== 'green'),
    })),
  };
}

interface PhotoRef {
  storageKey: string;
  thumbnailKey: string | null;
}

export function createProtocolsService(
  db: Db,
  files: FileStorage,
  inspections: InspectionsService,
  pdf: PdfRenderer | null,
  images: ImageProcessor,
) {
  async function dataUrl(key: string | null, mimeType: string): Promise<string | null> {
    if (!key || !(await files.exists(key))) return null;
    const bytes = await files.read(key);
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  async function build(
    auth: AuthContext,
    inspectionId: string,
    /** Equipment types in the protocol (empty = all of the inspection). */
    equipmentTypeIds: readonly string[] = [],
    /** Columns of Příloha 1 (none = the preset columns). */
    columns: readonly string[] = [],
    forceAppendix = false,
    defectSeverities?: ProtocolData['defectSeverities'],
    shortest = false,
  ): Promise<ProtocolData> {
    const inspection = await inspections.get(auth, inspectionId);
    // A protocol of some equipment types contains only their items and their protocol texts.
    const items = (await inspections.items(auth, inspectionId)).filter(
      (i) => !equipmentTypeIds.length || equipmentTypeIds.includes(i.equipmentTypeId),
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

    // Photos are references ("ref:<n>") until the layout knows their printed size; then each
    // is made from the original at 300 dpi of that size (`resolvePhotos`).
    const refs: PhotoRef[] = [];
    const refOf = (p: PhotoRef) => `ref:${refs.push(p) - 1}`;
    const resultPhotos = await db
      .select({
        itemId: inspectionResult.itemId,
        storageKey: photo.storageKey,
        thumbnailKey: photo.thumbnailKey,
      })
      .from(photo)
      .innerJoin(inspectionResult, eq(inspectionResult.id, photo.inspectionResultId))
      .where(eq(inspectionResult.inspectionId, inspectionId))
      .orderBy(photo.createdAt);
    const photosByItem = new Map<string, string[]>();
    for (const p of resultPhotos) {
      photosByItem.set(p.itemId, [...(photosByItem.get(p.itemId) ?? []), refOf(p)]);
    }
    const overview = await db
      .select({ storageKey: photo.storageKey, thumbnailKey: photo.thumbnailKey })
      .from(photo)
      .where(eq(photo.inspectionId, inspectionId))
      .orderBy(photo.createdAt);
    const overviewPhotos = overview.map(refOf);

    const inspectors = inspection.inspectors.map((i) => i.displayName);
    const nextDates: string[] = [];
    const sections = types
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
      .map((type) => {
        // Before closing: the earliest next date of the type's items (each by its interval:
        // item → location → site → type).
        const intervals = items
          .filter((i) => i.equipmentTypeId === type.id)
          .map((i) => i.intervalMonths);
        const next =
          inspection.nextInspectionDate ??
          nextInspectionDateOf(
            inspection.inspectionDate,
            intervals.length ? Math.min(...intervals) : type.defaultIntervalMonths,
            null,
          );
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
            ...printedResult(i.result, type.riskLevels),
            photos:
              (type.riskLevels && i.result?.includeInProtocol === false) ||
              i.result?.photosInProtocol === false
                ? []
                : (photosByItem.get(i.id) ?? []),
          }));
        return { typeName: type.name, text, items: rows };
      });

    // Issue date and version of this protocol (page header) unless fixed in Nastavení: closing
    // date (today for a draft) and 1 + reopenings; the lead technician's own authorization.
    const [issued] = await db
      .select({
        closedAt: inspectionTable.closedAt,
        reopenedCount: inspectionTable.reopenedCount,
        certification: appUser.certification,
        certifications: appUser.certifications,
      })
      .from(inspectionTable)
      .innerJoin(appUser, eq(appUser.id, inspectionTable.leadInspectorId))
      .where(eq(inspectionTable.id, inspection.id));
    const issueDate =
      settings.protocolIssueDate || czechDate((issued?.closedAt ?? new Date()).toISOString());
    const version = settings.protocolVersion || String((issued?.reopenedCount ?? 0) + 1);

    const data: ProtocolData = {
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
        // The lead technician's authorization for the types of this protocol.
        certification: certificationLines(
          issued?.certification ?? '',
          issued?.certifications ?? {},
          types.map((t) => ({ id: t.id, name: t.name })),
        ).join('\n'),
        issueDate,
        version,
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
      appendix: appendixOf(types, items, columns.length ? columns : DEFAULT_APPENDIX_COLUMNS),
      forceAppendix,
      defectSeverities,
      shortest,
      generatedAt: new Date().toISOString(),
    };
    return resolvePhotos(data, refs);
  }

  /**
   * Photos at 300 dpi of the size the layout prints them (JPEG, cropped to 4:3). Photos of
   * defects without a card (other severities) are left out. Falls back to the thumbnail.
   */
  async function resolvePhotos(data: ProtocolData, refs: PhotoRef[]): Promise<ProtocolData> {
    const layout = protocolLayout(data);
    const dpmm = 300 / 25.4;
    const height = Math.round(layout.photoHeight * dpmm);
    // Width as printed: depends on the column and how many photos share a row of the card.
    const widthFor = (columns: 1 | 2 | 3, count: number) =>
      Math.round(photoBox(columns, layout.photoHeight, count).width * dpmm);
    const shown = new Set(
      protocolDefectGroups(data).flatMap((g) =>
        g.places.flatMap((p) => p.defects.map((d) => d.itemNumber)),
      ),
    );
    const resolve = async (ref: string, width: number): Promise<string | null> => {
      const p = refs[Number(ref.slice(4))];
      if (!p) return null;
      if (await files.exists(p.storageKey)) {
        const fitted = await images.fit(await files.read(p.storageKey), width, height);
        if (fitted) return `data:image/jpeg;base64,${Buffer.from(fitted).toString('base64')}`;
      } else {
        // The database knows the photo but the file storage does not have it (lost volume?).
        console.warn(`protocol: photo file missing in storage: ${p.storageKey}`);
      }
      return dataUrl(p.thumbnailKey, 'image/jpeg');
    };
    const all = async (list: string[], columns: 1 | 2 | 3) => {
      const width = widthFor(columns, list.length);
      return (await Promise.all(list.map((ref) => resolve(ref, width)))).filter(
        (u): u is string => u !== null,
      );
    };
    const sections = [];
    for (const section of data.sections) {
      const items = [];
      for (const item of section.items) {
        items.push({
          ...item,
          photos: shown.has(item.itemNumber) ? await all(item.photos, layout.defectColumns) : [],
        });
      }
      sections.push({ ...section, items });
    }
    return { ...data, sections, overviewPhotos: await all(data.overviewPhotos, 1) };
  }

  /** `protokol-Provozovna-Brno-2026-11-03` (+ `-Zebrik` for a protocol of one type). */
  const baseName = (data: ProtocolData, options: ProtocolOptions) =>
    [
      options.part === 'appendix' ? 'priloha-1' : 'protokol',
      fileNamePart(data.site.name),
      data.inspectionDate,
      ...(options.equipmentTypeIds?.length && data.sections.length === 1
        ? [fileNamePart(data.sections[0]!.typeName)]
        : []),
    ].join('-');

  return {
    async html(auth: AuthContext, inspectionId: string, options: ProtocolOptions = {}) {
      return renderProtocolHtml(
        await build(
          auth,
          inspectionId,
          options.equipmentTypeIds,
          options.columns,
          options.forceAppendix,
          options.severities,
          options.shortest,
        ),
        { part: options.part },
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
      const data = await build(
        auth,
        inspectionId,
        options.equipmentTypeIds,
        options.columns,
        options.forceAppendix,
        options.severities,
        options.shortest,
      );
      const bytes = await pdf.render(
        renderProtocolHtml(data, { pageFrame: false, part: options.part }),
        {
          header: protocolPageHeader(data),
          footer: protocolPageFooter(data),
          margin: PROTOCOL_PDF_MARGINS,
        },
      );
      return {
        data: options.twoUp ? await twoPagesPerSheet(bytes) : bytes,
        fileName: `${baseName(data, options)}${options.twoUp ? '-2-na-list' : ''}.pdf`,
      };
    },

    /** The protocol as an editable Word document (works in the browser demo too). */
    async docx(
      auth: AuthContext,
      inspectionId: string,
      options: ProtocolOptions = {},
    ): Promise<{ data: Uint8Array; fileName: string }> {
      const data = await build(
        auth,
        inspectionId,
        options.equipmentTypeIds,
        options.columns,
        options.forceAppendix,
        options.severities,
        options.shortest,
      );
      return {
        data: await renderProtocolDocx(data, options.part),
        fileName: `${baseName(data, options)}.docx`,
      };
    },

    /** One PDF protocol per equipment type of the inspection (or of the chosen ones), as ZIP. */
    async pdfPerType(
      auth: AuthContext,
      inspectionId: string,
      options: ProtocolOptions & { twoUp?: boolean } = {},
    ): Promise<{ data: Uint8Array; fileName: string }> {
      const items = await inspections.items(auth, inspectionId);
      const typeIds = [...new Set(items.map((i) => i.equipmentTypeId))].filter(
        (id) => !options.equipmentTypeIds?.length || options.equipmentTypeIds.includes(id),
      );
      const files: Record<string, Uint8Array> = {};
      let base = 'protokoly';
      for (const typeId of typeIds) {
        // One after another: Chromium renders one PDF at a time.
        const file = await this.pdf(auth, inspectionId, { ...options, equipmentTypeIds: [typeId] });
        files[file.fileName] = file.data;
        base = file.fileName.replace(/^protokol-/, 'protokoly-').replace(/-[^-]+\.pdf$/, '');
      }
      return { data: zipSync(files, { level: 0 }), fileName: `${base}.zip` };
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

/** Options of a protocol: one equipment type only, Příloha 1 columns and use, one part only. */
export interface ProtocolOptions {
  /** Equipment types in the protocol (empty = all of the inspection). */
  equipmentTypeIds?: string[];
  columns?: string[];
  /** Příloha 1 even when the table fits on the first page. */
  forceAppendix?: boolean;
  /** `appendix`: only Příloha 1. */
  part?: 'all' | 'appendix';
  /** Risk levels whose defects get cards with photos (default all). */
  severities?: ('red' | 'amber' | 'green')[];
  /** The fewest pages (minimal photos, more columns) even within 8 pages. */
  shortest?: boolean;
}

export type ProtocolsService = ReturnType<typeof createProtocolsService>;
