import { z } from 'zod';
import { idSchema } from './api/common.js';

/** `GET /audit`: one record of the audit log (newest first). */
export const auditEntrySchema = z.object({
  id: idSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actor: z.object({ id: z.string(), displayName: z.string() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Areas of the audit (entity types) for the filter in Historie změn. */
export const AUDIT_AREAS: { value: string; label: string }[] = [
  { value: 'item', label: 'Artikly' },
  { value: 'inspection', label: 'Kontroly' },
  { value: 'inspection_result', label: 'Výsledky kontrol' },
  { value: 'photo', label: 'Fotky' },
  { value: 'equipment_type', label: 'Typy vybavení' },
  { value: 'customer', label: 'Zákazníci' },
  { value: 'site', label: 'Provozovny' },
  { value: 'location', label: 'Umístění' },
  { value: 'user', label: 'Uživatelé a přihlášení' },
  { value: 'organization', label: 'Nastavení firmy' },
  { value: 'import_job', label: 'Importy' },
];

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Přihlášení',
  'auth.login_failed': 'Neúspěšné přihlášení',
  'auth.password_change': 'Změna hesla',
  'user.create': 'Nový uživatel',
  'user.update': 'Úprava uživatele',
  'user.update.password_reset': 'Reset hesla uživatele',
  'user.delete': 'Smazání uživatele',
  'user.profile': 'Úprava profilu',
  'customer.create': 'Nový zákazník',
  'customer.update': 'Úprava zákazníka',
  'customer.archive': 'Archivace zákazníka',
  'site.create': 'Nová provozovna',
  'site.update': 'Úprava provozovny',
  'site.archive': 'Archivace provozovny',
  'location.create': 'Nové umístění',
  'location.update': 'Úprava umístění',
  'location.move': 'Přesun umístění',
  'location.archive': 'Archivace umístění',
  'equipment_type.create': 'Nový typ vybavení',
  'equipment_type.update': 'Úprava typu vybavení',
  'equipment_type.archive': 'Archivace typu vybavení',
  'equipment_type.merge': 'Sloučení typů vybavení',
  'item.create': 'Nový artikl',
  'item.update': 'Úprava artiklu',
  'item.status': 'Změna stavu artiklu',
  'item.retire': 'Vyřazení artiklu z evidence',
  'item.next_inspection': 'Datum příští kontroly',
  'item.field_kind_conversion': 'Převod hodnot pole',
  'item.import': 'Import artiklu',
  'item.import_update': 'Import – úprava artiklu',
  'import.commit': 'Import dokončen',
  'inspection.start': 'Zahájení kontroly',
  'inspection.update': 'Úprava kontroly',
  'inspection.join': 'Připojení technika ke kontrole',
  'inspection.close': 'Uzavření kontroly',
  'inspection.reopen': 'Znovuotevření kontroly',
  'inspection.result': 'Zápis výsledku',
  'inspection.result_update': 'Změna výsledku',
  'inspection.result_overruled': 'Výsledek přepsán novějším',
  'inspection.result_delete': 'Zrušení výsledku',
  'inspection.result_photos_in_protocol': 'Fotky do protokolu',
  'photo.create': 'Nová fotka',
  'photo.delete': 'Smazání fotky',
  'photo.move': 'Přesun fotky',
  'photo.delete_previous_defect_photos': 'Smazání starších fotek závad',
  'organization.update': 'Úprava nastavení firmy',
  'organization.logo': 'Změna loga',
  'system.bootstrap': 'Založení systému',
};

/** Czech name of an action ("photo.delete" → "Smazání fotky"); unknown ones as they are. */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** What a record is about: "Artikl 62", "Kontrola 03/11/2026", the name, e-mail… */
export function auditEntityLabel(
  entry: Pick<AuditEntry, 'entityType' | 'before' | 'after'>,
): string {
  const data = { ...record(entry.before), ...record(entry.after) };
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
  if (text('itemNumber')) {
    return `Artikl ${text('itemNumber')}${text('designation') ? ` (${text('designation')})` : ''}`;
  }
  // Items without číslo TZ (ADR-0020) are named by their designation.
  if (entry.entityType === 'item' && text('designation')) return `Artikl ${text('designation')}`;
  if (entry.entityType === 'inspection' && text('inspectionDate')) {
    const [y, m, d] = text('inspectionDate').split('-');
    return `Kontrola ${d}/${m}/${y}`;
  }
  return text('name') || text('displayName') || text('email') || text('defectDescription') || '';
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Název',
  displayName: 'Jméno',
  email: 'E-mail',
  role: 'Role',
  active: 'Aktivní',
  certification: 'Oprávnění',
  itemNumber: 'Číslo TZ',
  designation: 'Označení',
  qrCode: 'QR kód',
  status: 'Stav',
  nextInspectionDate: 'Příští kontrola',
  inspectionIntervalMonths: 'Interval kontrol',
  defaultIntervalMonths: 'Interval kontrol',
  locationId: 'Umístění',
  siteId: 'Provozovna',
  equipmentTypeId: 'Typ vybavení',
  fieldValues: 'Hodnoty polí',
  fieldDefinitions: 'Pole typu',
  protocolTemplate: 'Text protokolu',
  riskLevels: 'Hodnocení rizika',
  outcome: 'Výsledek',
  severity: 'Úroveň',
  defectDescription: 'Popis závady',
  takenOutOfService: 'Vyřazení z provozu',
  includeInProtocol: 'V protokolu',
  photosInProtocol: 'Fotky do protokolu',
  inspectionDate: 'Datum kontroly',
  note: 'Poznámka',
  address: 'Adresa',
  retiredAt: 'Vyřazeno z evidence',
  archivedAt: 'Archivováno',
  itemId: 'Artikl',
  inspectionResultId: 'Výsledek',
};

/** Bookkeeping columns that change with every write. */
const IGNORED = new Set(['updatedAt', 'createdAt', 'version', 'passwordHash', 'organizationId']);

const shown = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '–';
  if (value === true) return 'ano';
  if (value === false) return 'ne';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/** The values a record changed ("Stav: in_service → out_of_service"), bookkeeping left out. */
export function auditChanges(
  entry: Pick<AuditEntry, 'before' | 'after'>,
): { field: string; from: string; to: string }[] {
  const before = record(entry.before);
  const after = record(entry.after);
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !IGNORED.has(k),
  );
  return keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => ({ field: FIELD_LABELS[k] ?? k, from: shown(before[k]), to: shown(after[k]) }));
}
