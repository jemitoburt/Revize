import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TYPE_PRESETS } from './equipment-presets.js';
import {
  addMonths,
  nextInspectionDateOf,
  placeOf,
  protocolPageHeader,
  protocolTextHtml,
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
      issueDate: '01.10.2026',
      version: '1',
      pageFooter: 'BOZP • PO • REVIZE',
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
        text: '# Žebříky\n• Kontrola zahrnuje:\n  • vizuální kontrolu,\n  • zkoušku stability.',
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

  it('renders the form: details, ANO/NE table, signatures, texts, defects; escapes text', () => {
    const html = renderProtocolHtml(data);
    expect(html).toContain('Revize &lt;Novák&gt;, Hlavní 1, Brno, IČ: 12345678');
    expect(html).not.toContain('Revize <Novák>');
    expect(html).toContain('PŘEDBĚŽNÝ PROTOKOL');
    expect(html).toContain('<td class="grey">Kontrola provedena dne</td><td>03/11/2026</td>');
    expect(html).toContain('Následnou kontrolu provést nejpozději do</td><td>03/11/2027</td>');
    // "nehodící se škrtněte": OK strikes NE, a defect strikes ANO, unchecked strikes nothing.
    expect(html).toContain('<td class="c-yn">ANO</td><td class="c-yn struck">NE</td><td></td>');
    expect(html).toContain('<td class="c-yn struck">ANO</td><td class="c-yn">NE</td><td>Prasklá');
    expect(html).toContain(
      '<td class="c-yn">ANO</td><td class="c-yn">NE</td><td>Nezkontrolováno</td>',
    );
    expect(html).toContain('Žluté riziko');
    expect(html).toContain('Pokyny k provádění kontrol</h2><div class="texts"><h3>Žebříky</h3>');
    expect(html).toContain('<li>Kontrola zahrnuje:<ul><li>vizuální kontrolu,</li>');
    expect(html).toContain('Za odstranění případných závad odpovídá provozovatel.');
    expect(html).toContain('Osvědčení č. 12/2025');
    expect(html).toContain('BOZP • PO • REVIZE');
    // Defects on their own pages: serious (red) first, then the others.
    // Defects by severity (red first), then by workplace, the risk explained once per group.
    expect(html.indexOf('Červené riziko (1)')).toBeGreaterThan(html.indexOf('photo-pages'));
    expect(html.indexOf('Červené riziko (1)')).toBeLessThan(html.indexOf('Žluté riziko (1)'));
    expect(html).toContain('<h3 class="place">Hala A</h3>');
    expect(html).toContain('<div class="t">10002 · Řada 1</div>');
    expect(placeOf('Hala A › Řada 1 › Pozice 4')).toEqual({
      place: 'Hala A',
      rest: 'Řada 1 › Pozice 4',
    });
    expect(html).toContain('<img src="data:image/jpeg;base64,AAAA"');
  });
  it('omits the draft banner once closed and the page frame for the PDF renderer', () => {
    expect(renderProtocolHtml({ ...data, final: true })).not.toContain('PŘEDBĚŽNÝ PROTOKOL');
    expect(renderProtocolHtml(data, { pageFrame: false })).not.toContain('class="ph"');
    expect(protocolPageHeader(data)).toContain('<span class="pageNumber"></span> z');
  });
  it('prints a text shared by several types once', () => {
    const twice = {
      ...data,
      sections: [data.sections[0]!, { ...data.sections[0]!, typeName: 'Jiný' }],
    };
    expect(renderProtocolHtml(twice).split('<h3>Žebříky</h3>')).toHaveLength(2);
  });
});

describe('protocolTextHtml', () => {
  it('renders headings, items, sub-items, continued lines and paragraphs', () => {
    expect(protocolTextHtml('# Regály\n• první\n  pokračuje\n  - pod\n\nOdstavec\nřádek')).toBe(
      '<h3>Regály</h3><ul><li>první pokračuje<ul><li>pod</li></ul></li></ul><p>Odstavec<br>řádek</p>',
    );
  });
  it('renders every preset text with its heading and list', () => {
    for (const preset of EQUIPMENT_TYPE_PRESETS) {
      const html = protocolTextHtml(preset.protocolTemplate);
      expect(html, preset.key).toMatch(/^<h3>.+<\/h3><ul><li>.+<ul><li>/);
    }
  });
});
