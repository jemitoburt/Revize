import type { InspectionItem } from '@revize/shared';
import { describe, expect, it } from 'vitest';
import type { OutboxRow } from '../platform/local-db.js';
import { applyPending } from './overlay.js';

const item = {
  id: 'i1',
  itemNumber: '10001',
  designation: 'A1-01',
  qrCode: null,
  equipmentTypeId: 't1',
  locationId: null,
  locationPath: [],
  fieldValues: {},
  status: 'in_service',
  nextInspectionDate: null,
  itemPhotoCount: 0,
  intervalMonths: 12,
  result: null,
} satisfies InspectionItem;

describe('applyPending', () => {
  it('shows a field edit that is still on the device over the item', () => {
    const edit = {
      seq: 1,
      kind: 'item',
      method: 'PATCH',
      inspectionId: 'x',
      itemId: 'i1',
      preview: { id: 'i1', designation: 'A1-99' },
    } as unknown as OutboxRow;
    const [shown] = applyPending([item], 'x', [edit]);
    expect(shown).toMatchObject({ itemNumber: '10001', designation: 'A1-99' });
    // An edit of an item that is not in the list does not add a half item.
    expect(applyPending([], 'x', [edit])).toEqual([]);
  });
});
