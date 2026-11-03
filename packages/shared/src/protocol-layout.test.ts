import { describe, expect, it } from 'vitest';
import { choosePhotoLayout, defectPages, tableRowHeight } from './protocol-layout.js';

const card = (photos: number) => ({ photos, titleLength: 70, descriptionLength: 20 });

describe('protocol layout', () => {
  it('estimates taller rows for long notes', () => {
    const item = {
      itemNumber: '1',
      designation: 'Ž-01',
      location: 'Hala A',
      details: 'Alve',
      outcome: 'amber' as const,
      defectDescription: null,
      photos: [],
    };
    expect(tableRowHeight(item, [])).toBeLessThan(12);
    expect(tableRowHeight(item, ['x'.repeat(200)])).toBeGreaterThan(20);
  });

  it('keeps large photos when the defects fit on one page anyway', () => {
    expect(choosePhotoLayout([[card(1), card(2)]])).toEqual({
      photoHeight: 60,
      columns: 1,
      pages: 1,
    });
  });

  it('shrinks photos (not below 3.5 cm) to save pages', () => {
    const many = Array.from({ length: 8 }, () => card(2));
    const big = defectPages([many], 60, 1);
    const layout = choosePhotoLayout([many]);
    expect(layout.pages).toBeLessThan(big);
    expect(layout.photoHeight).toBeGreaterThanOrEqual(35);
    expect(layout.photoHeight).toBeLessThan(60);
  });

  it('uses two columns when every defect has one photo and it saves pages', () => {
    const one = Array.from({ length: 10 }, () => card(1));
    expect(choosePhotoLayout([one]).columns).toBe(2);
    // With two photos on a defect there is no second column.
    expect(choosePhotoLayout([[...one, card(2)]]).columns).toBe(1);
  });
});
