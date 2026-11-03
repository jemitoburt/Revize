import type { InspectionItem, InspectionProgress, Severity } from './api/inspections.js';
import type { ScanTarget } from './scan-payload.js';

/**
 * Two technicians may record the same item (ADR-0004): the result recorded later on the device
 * wins, also when the earlier one reaches the server last (offline queue). Equal times: the
 * incoming write wins, so that repeating a request is harmless.
 */
export function shouldApplyResult(existingRecordedAt: Date, incomingRecordedAt: Date): boolean {
  return incomingRecordedAt.getTime() >= existingRecordedAt.getTime();
}

type ScanCandidate = Pick<InspectionItem, 'qrCode' | 'itemNumber'>;

/**
 * The item a scanned code or typed number refers to: the QR code first, then (for purely
 * numeric codes) the item number without leading zeros (ADR-0012).
 */
export function findScannedItem<T extends ScanCandidate>(
  items: readonly T[],
  target: ScanTarget,
): T | null {
  const byQr = items.find((i) => i.qrCode !== null && i.qrCode === target.code);
  if (byQr) return byQr;
  if (target.kind === 'digits')
    return items.find((i) => i.itemNumber === target.itemNumber) ?? null;
  return null;
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

export const SEVERITY_LABELS: Record<Severity, { short: string; hint: string }> = {
  green: { short: 'Zelená', hint: 'Sledovat, bez omezení provozu' },
  amber: {
    short: 'Oranžová',
    hint: 'Opravit co nejdřív (do 4 týdnů), poškozené místo nezatěžovat',
  },
  red: { short: 'Červená', hint: 'Ihned odlehčit a vyřadit z provozu do opravy' },
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

/** Label of a result as shown in lists and the protocol. */
export function outcomeLabel(result: LabelledResult | null): string {
  if (!result) return OUTCOME_LABELS.unchecked;
  const severity = severityOf(result);
  if (!severity) return OUTCOME_LABELS.ok;
  if (severity === 'red') return OUTCOME_LABELS.outOfService;
  return `Závada – ${SEVERITY_LABELS[severity].short.toLowerCase()}`;
}
