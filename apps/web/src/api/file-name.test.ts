import { describe, expect, it } from 'vitest';
import { stampedFileName } from './client.js';

describe('download names', () => {
  it('get the time, so a new download never hides behind an older file', () => {
    const at = new Date(2026, 10, 4, 9, 5);
    expect(stampedFileName('fotky-Vyroba-2026-11-03.zip', at)).toBe(
      'fotky-Vyroba-2026-11-03_0905.zip',
    );
    expect(stampedFileName('evidence', at)).toBe('evidence_0905');
  });
});
