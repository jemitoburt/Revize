import { FIELD_KIND_LABELS, type FieldDefinition } from '@revize/shared';
import ExcelJS from 'exceljs';

const STANDARD_COLUMNS = [
  'Číslo TZ',
  'Označení',
  'QR kód',
  'Hala',
  'Řada',
  'Pozice',
  'Příští kontrola',
];

/**
 * Empty XLSX for one equipment type: the columns the import recognizes automatically, option
 * lists as cell validation, and a help sheet. Importing the filled template needs no mapping.
 */
export async function importTemplate(
  typeName: string,
  definitions: readonly FieldDefinition[],
): Promise<Buffer> {
  const fields = definitions.filter((f) => !f.archived).sort((a, b) => a.order - b.order);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Revize';
  const sheet = workbook.addWorksheet('Artikly', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [...STANDARD_COLUMNS, ...fields.map((f) => f.label)].map((header) => ({
    header,
    width: Math.max(12, header.length + 4),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  fields.forEach((field, i) => {
    const column = STANDARD_COLUMNS.length + i + 1;
    const list =
      field.kind === 'select' ? field.options : field.kind === 'boolean' ? ['ano', 'ne'] : null;
    // Excel limits an inline list to 255 characters; longer lists stay on the help sheet only.
    if (list && list.join(',').length <= 250) {
      for (let row = 2; row <= 1000; row++) {
        sheet.getCell(row, column).dataValidation = {
          type: 'list',
          allowBlank: !field.required,
          formulae: [`"${list.join(',')}"`],
        };
      }
    }
  });

  const help = workbook.addWorksheet('Nápověda');
  help.columns = [
    { header: 'Sloupec', width: 30 },
    { header: 'Druh', width: 22 },
    { header: 'Povinné', width: 10 },
    { header: 'Povolené hodnoty / formát', width: 70 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRows([
    [
      'Číslo TZ',
      'Číslo (4 nebo 5 číslic)',
      'ne',
      'V celé evidenci jen jednou. Prázdné = přidělí se další volné číslo. Úvodní nuly se nepočítají.',
    ],
    [
      'Označení',
      'Text',
      'ne',
      'Např. Ž-01 nebo A1-12 (předvolba a číslo), v provozovně jen jednou.',
    ],
    ['QR kód', 'Text', 'ne', 'Obsah QR štítku, pokud se liší od čísla TZ.'],
    ['Hala / Řada / Pozice', 'Text', 'ne', 'Umístění; chybějící se při importu mohou založit.'],
    ['Příští kontrola', 'Datum', 'ne', 'Např. 31/12/2026'],
    ...fields.map((f) => [
      f.label,
      FIELD_KIND_LABELS[f.kind],
      f.required ? 'ano' : 'ne',
      f.kind === 'select' || f.kind === 'multiselect'
        ? f.options.join(', ') + (f.kind === 'multiselect' ? ' (více hodnot oddělte čárkou)' : '')
        : f.kind === 'boolean'
          ? 'ano / ne'
          : f.kind === 'date'
            ? 'Např. 31.12.2026'
            : f.unit
              ? `Číslo v jednotkách ${f.unit}`
              : (f.help ?? ''),
    ]),
  ]);
  help.addRow([]);
  help.addRow([`Šablona pro typ „${typeName}“`]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
