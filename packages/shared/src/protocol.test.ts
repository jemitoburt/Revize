import { describe, expect, it } from 'vitest';
import {
  addMonths,
  nextInspectionDateOf,
  renderProtocolHtml,
  type ProtocolData,
} from './protocol.js';

describe('protocol text and dates', () => {
  it('adds months and clamps the day to the end of the month', () => {
    expect(addMonths('2026-11-03', 12)).toBe('2027-11-03');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2026-05-15', -6)).toBe('2025-11-15');
  });
  it('uses the inspection-wide next date, otherwise the type interval', () => {
    expect(nextInspectionDateOf('2026-11-03', 12, null)).toBe('2027-11-03');
    expect(nextInspectionDateOf('2026-11-03', 12, '2027-06-30')).toBe('2027-06-30');
  });
});

describe('renderProtocolHtml', () => {
  const data: ProtocolData = {
    number: '2026-11-03/1a2b3c4d',
    final: false,
    company: {
      name: 'Revize <Novák>',
      companyId: '12345678',
      address: 'Hlavní 1, Brno',
      phone: '',
      email: 'info@revize.cz',
      web: '',
      logo: null,
      footer: 'Protokol je platný bez razítka.',
      certification: 'Osvědčení č. 12/2025',
    },
    customer: { name: 'Sklad s.r.o.', companyId: null, address: null },
    site: { name: 'Hala Brno', address: null },
    inspectionDate: '2026-11-03',
    nextInspectionDate: '2027-11-03',
    inspectors: ['Jan Technik'],
    leadInspector: 'Jan Technik',
    note: null,
    sections: [
      {
        typeName: 'Žebřík',
        text: 'Kontrola u Sklad s.r.o.\n\nDruhý odstavec.',
        items: [
          {
            itemNumber: '10001',
            location: 'Hala A › Řada 1',
            details: 'Alve',
            outcome: 'ok',
            defectDescription: null,
            photos: [],
          },
          {
            itemNumber: '10002',
            location: 'Hala A › Řada 1',
            details: 'Krause',
            outcome: 'red',
            defectDescription: 'Prasklá štěřina',
            photos: ['data:image/jpeg;base64,AAAA'],
          },
          {
            itemNumber: '10003',
            location: 'Hala B',
            details: 'Hailo',
            outcome: 'amber',
            defectDescription: 'Chybí patka',
            photos: [],
          },
          {
            itemNumber: '4001',
            location: 'Hala C',
            details: '',
            outcome: 'unchecked',
            defectDescription: null,
            photos: [],
          },
        ],
      },
    ],
    overviewPhotos: [],
    generatedAt: '2026-11-03T10:00:00Z',
  };

  it('renders the header, summary, items, defects and signatures; escapes text', () => {
    const html = renderProtocolHtml(data);
    expect(html).toContain('Revize &lt;Novák&gt;');
    expect(html).not.toContain('Revize <Novák>');
    expect(html).toContain('PŘEDBĚŽNÝ PROTOKOL');
    expect(html).toContain('<b>3 / 4</b>zkontrolováno');
    expect(html).toContain('<p>Druhý odstavec.</p>');
    // Defects on their own pages: serious (red) first, then the others.
    expect(html.indexOf('Závažné závady (1)')).toBeGreaterThan(html.indexOf('photo-pages'));
    expect(html.indexOf('Závažné závady (1)')).toBeLessThan(html.indexOf('Závady (1)'));
    expect(html).toContain('<th class="c-ok">Vyhovuje</th>');
    expect(html).toContain('<img src="data:image/jpeg;base64,AAAA"');
    expect(html).toContain('Nezkontrolováno');
    expect(html).toContain('Osvědčení č. 12/2025');
    expect(html).toContain('3. 11. 2026');
  });
  it('omits the draft banner once the inspection is closed', () => {
    expect(renderProtocolHtml({ ...data, final: true })).not.toContain('PŘEDBĚŽNÝ PROTOKOL');
  });
});
