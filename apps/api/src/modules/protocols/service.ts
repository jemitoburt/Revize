import {
  LOCATION_SEPARATOR,
  displayFields,
  fillProtocolTemplate,
  nextInspectionDateOf,
  renderProtocolHtml,
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

/** Item details shown in the protocol table: the first few filled-in fields of the type. */
const DETAIL_FIELDS = 3;

const czechDate = (iso: string | null) => {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
};

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

  async function build(auth: AuthContext, inspectionId: string): Promise<ProtocolData> {
    const inspection = await inspections.get(auth, inspectionId);
    const items = await inspections.items(auth, inspectionId);
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
            location: i.locationPath.join(LOCATION_SEPARATOR) || 'Bez umístění',
            details: displayFields(type.fieldDefinitions, i.fieldValues)
              .slice(0, DETAIL_FIELDS)
              .map((f) => f.value)
              .join(' · '),
            outcome: !i.result
              ? 'unchecked'
              : i.result.outcome === 'ok'
                ? 'ok'
                : i.result.takenOutOfService
                  ? 'out_of_service'
                  : 'defect',
            defectDescription: i.result?.defectDescription ?? null,
            photos: photosByItem.get(i.id) ?? [],
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
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    async html(auth: AuthContext, inspectionId: string): Promise<string> {
      return renderProtocolHtml(await build(auth, inspectionId));
    },

    async pdf(
      auth: AuthContext,
      inspectionId: string,
    ): Promise<{ data: Uint8Array; fileName: string }> {
      if (!pdf) {
        throw new AppError(501, 'pdf_unavailable', 'PDF se zde nevytváří, použijte tisk náhledu.');
      }
      const data = await build(auth, inspectionId);
      const bytes = await pdf.render(
        renderProtocolHtml(data),
        `${data.company.name} · protokol ${data.number}`,
      );
      const slug = data.site.name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return { data: bytes, fileName: `protokol-${slug}-${data.inspectionDate}.pdf` };
    },
  };
}

export type ProtocolsService = ReturnType<typeof createProtocolsService>;
