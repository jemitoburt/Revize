import type { InspectionItem, InspectionResult } from '@revize/shared';
import type { OutboxRow } from '../platform/local-db.js';

/**
 * The working list as the technician sees it: the server's (or stored) list with the commands
 * that are still on the device applied in order – new items, results, undone results, photos.
 */
export function applyPending(
  items: readonly InspectionItem[],
  inspectionId: string,
  commands: readonly OutboxRow[],
): InspectionItem[] {
  const list = items.map((i) => ({ ...i }));
  const byId = new Map(list.map((i) => [i.id, i]));
  for (const command of [...commands].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (command.kind === 'item' && command.inspectionId === inspectionId) {
      const preview = command.preview as InspectionItem;
      const existing = byId.get(preview.id);
      if (command.method === 'PATCH') {
        // A field edit: its changed fields over the item (new or from the server).
        if (existing) Object.assign(existing, preview);
      } else if (!existing) {
        const added = { ...preview };
        list.push(added);
        byId.set(added.id, added);
      }
      continue;
    }
    const target = command.itemId ? byId.get(command.itemId) : undefined;
    if (!target) continue;
    if (command.kind === 'result' && command.inspectionId === inspectionId) {
      const result = command.preview as InspectionResult;
      target.result = { ...result, photoCount: target.result?.photoCount ?? 0 };
      if (result.takenOutOfService) target.status = 'out_of_service';
    } else if (command.kind === 'result-delete' && command.inspectionId === inspectionId) {
      target.result = null;
    } else if (command.kind === 'photo') {
      const owner = (command.body as { owner: string }).owner;
      if (owner === 'item') target.itemPhotoCount += 1;
      if (owner === 'result' && target.result && command.inspectionId === inspectionId) {
        target.result = { ...target.result, photoCount: target.result.photoCount + 1 };
      }
    }
  }
  return list;
}
