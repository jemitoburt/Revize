import type { InspectionItem, InspectionProgress, Severity } from './api/inspections.js';
import { normalizeDesignation } from './item-number.js';
import type { ScanTarget } from './scan-payload.js';

/**
 * Two technicians may record the same item (ADR-0004): the result recorded later on the device
 * wins, also when the earlier one reaches the server last (offline queue). Equal times: the
 * incoming write wins, so that repeating a request is harmless.
 */
export function shouldApplyResult(existingRecordedAt: Date, incomingRecordedAt: Date): boolean {
  return incomingRecordedAt.getTime() >= existingRecordedAt.getTime();
}

type ScanCandidate = Pick<InspectionItem, 'qrCode' | 'itemNumber' | 'designation'>;

/**
 * The item a scanned code or typed text refers to: the QR code first, then (for purely
 * numeric codes) číslo TZ without leading zeros (ADR-0012), then the designation ("Ž-01",
 * case, spaces and dashes ignored).
 */
export function findScannedItem<T extends ScanCandidate>(
  items: readonly T[],
  target: ScanTarget,
): T | null {
  const byQr = items.find((i) => i.qrCode !== null && i.qrCode === target.code);
  if (byQr) return byQr;
  if (target.kind === 'digits') {
    const byNumber = items.find((i) => i.itemNumber === target.itemNumber);
    if (byNumber) return byNumber;
  }
  const wanted = normalizeDesignation(target.code);
  if (!wanted) return null;
  return items.find((i) => i.designation && normalizeDesignation(i.designation) === wanted) ?? null;
}

/** Progress of an inspection from its working list (the server computes the same in SQL). */
export function progressOf(items: readonly Pick<InspectionItem, 'result'>[]): InspectionProgress {
  const progress = { total: items.length, checked: 0, ok: 0, defect: 0, outOfService: 0 };
  for (const { result } of items) {
    if (!result) continue;
    progress.checked += 1;
    if (result.outcome === 'ok') progress.ok += 1;
    else {
      progress.defect += 1;
      if (result.takenOutOfService) progress.outOfService += 1;
    }
  }
  return progress;
}

export const OUTCOME_LABELS = {
  ok: 'V pořádku',
  defect: 'Závada',
  outOfService: 'Vyřazeno z provozu',
  unchecked: 'Nezkontrolováno',
} as const;

/**
 * Risk levels of a defect after ČSN EN 15635 (kap. 9.5, zelené / žluté / červené riziko). The
 * key `amber` stays for stored data; the Czech edition of the standard calls the level "žlutá".
 * `hint` is shown in the field, `protocol` next to the defect in the protocol.
 */
export const SEVERITY_LABELS: Record<Severity, { short: string; hint: string; protocol: string }> =
  {
    green: {
      short: 'Zelená',
      hint: 'Poškození v mezích tolerance. Lze dále používat, poškození se zaznamená a sleduje při dalších kontrolách.',
      protocol: 'Zelené riziko – poškození v mezích tolerance, sledovat při dalších kontrolách.',
    },
    amber: {
      short: 'Žlutá',
      hint: 'Nebezpečné poškození vyžadující opravu. Poškozenou část vyprázdnit a do opravy znovu nezaplňovat; není-li opravena do 4 týdnů, přechází do červeného rizika.',
      protocol:
        'Žluté riziko – vyprázdnit a do opravy nezaplňovat; nebude-li opraveno do 4 týdnů, platí červené riziko.',
    },
    red: {
      short: 'Červená',
      hint: 'Velmi vážné poškození vyžadující okamžitý zásah. Ihned vyprázdnit a vyřadit z užívání až do opravy.',
      protocol: 'Červené riziko – okamžitě vyprázdnit a vyřadit z užívání až do opravy.',
    },
  };

type LabelledResult = {
  outcome: 'ok' | 'defect';
  takenOutOfService: boolean;
  severity?: Severity | null;
};

/** Severity of a result for display (older results without severity: red when out of service). */
export function severityOf(result: LabelledResult): Severity | null {
  if (result.outcome === 'ok') return null;
  return result.severity ?? (result.takenOutOfService ? 'red' : 'amber');
}

/** Results of types without risk levels (everything but racks): fit or unfit. */
export const FIT_LABELS = { ok: 'Vyhovuje', defect: 'Nevyhovuje' } as const;

/**
 * Label of a result as shown in lists and the protocol. `riskLevels`: the type rates defects
 * green/yellow/red (ČSN EN 15635, racks); otherwise the result is "Vyhovuje" / "Nevyhovuje".
 */
export function outcomeLabel(result: LabelledResult | null, riskLevels = true): string {
  if (!result) return OUTCOME_LABELS.unchecked;
  if (!riskLevels) return FIT_LABELS[result.outcome];
  const severity = severityOf(result);
  if (!severity) return OUTCOME_LABELS.ok;
  if (severity === 'red') return OUTCOME_LABELS.outOfService;
  return `Závada – ${SEVERITY_LABELS[severity].short.toLowerCase()}`;
}
