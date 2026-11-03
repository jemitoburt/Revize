import { fieldDefinitionsSchema, type FieldDefinition } from './equipment-fields.js';

/**
 * Library of equipment types derived from the relevant standards and common manufacturers.
 * Used for demo data and offered in the administration ("Přidat z knihovny"); every type can be
 * edited afterwards. Protocol texts are drafts – the inspection company should check them
 * against the current wording of the standards and its own practice.
 *
 * Placeholders in protocol texts: {{zakaznik}}, {{provozovna}}, {{datum_kontroly}},
 * {{technik}}, {{datum_pristi_kontroly}}.
 */
export interface EquipmentTypePreset {
  key: string;
  name: string;
  description: string;
  standards: string[];
  defaultIntervalMonths: number;
  fieldDefinitions: FieldDefinition[];
  protocolTemplate: string;
}

const LADDER_MANUFACTURERS = [
  'Alve',
  'Krause',
  'Hailo',
  'Zarges',
  'Hymer',
  'Günzburger Steigtechnik',
  'Svelt',
  'Facal',
  'Werner',
  'Drabest',
];

const RACK_MANUFACTURERS = [
  'Mecalux',
  'Jungheinrich',
  'Stow',
  'Dexion',
  'Kasten',
  'Nedcon',
  'META',
  'AR Racking',
  'SSI Schäfer',
  'Proma',
];

const fields = (defs: unknown[]) => fieldDefinitionsSchema.parse(defs);

const common = {
  year: (order: number) => ({
    key: 'year',
    label: 'Rok výroby',
    kind: 'integer',
    order,
  }),
  serial: (order: number) => ({
    key: 'serial_number',
    label: 'Výrobní číslo',
    kind: 'text',
    order,
  }),
  note: (order: number) => ({
    key: 'note',
    label: 'Poznámka',
    kind: 'text',
    order,
  }),
};

const rackCommon = (from: number) => [
  {
    key: 'load_sign',
    label: 'Štítek nosnosti',
    kind: 'boolean',
    help: 'Štítek s nosností úrovní a pole je umístěn a čitelný (ČSN EN 15635).',
    order: from,
  },
  {
    key: 'anchored',
    label: 'Kotvení do podlahy',
    kind: 'boolean',
    order: from + 1,
  },
  {
    key: 'upright_protection',
    label: 'Ochrana stojin / čel',
    kind: 'boolean',
    help: 'Nárazníky stojin nebo ochranná zábrana čela uličky.',
    order: from + 2,
  },
  { ...common.year(from + 3) },
  { ...common.note(from + 4) },
];

const RACK_PROTOCOL = (kind: string, extra: string) =>
  `Kontrola ${kind} byla provedena dne {{datum_kontroly}} u zákazníka {{zakaznik}}, provozovna {{provozovna}}, ` +
  `v rozsahu odborné inspekce podle ČSN EN 15635 (Skladovací systémy z oceli – Používání a údržba skladovacího zařízení) ` +
  `a návodu výrobce.\n\n` +
  `Posuzován byl zejména stav stojin a rámů (deformace, praskliny, koroze), nosníků a jejich pojistek proti vysazení, ` +
  `spojů a kotvení, svislost a přímost konstrukce, ochrana stojin, čitelnost štítků nosnosti a dodržování uvedeného zatížení. ${extra}\n\n` +
  `Zjištěné závady jsou uvedeny v protokolu u jednotlivých artiklů. Artikly označené jako vyřazené z provozu je nutné ` +
  `neprodleně odlehčit a nepoužívat až do opravy originálními díly výrobce (nebo rovnocennými) a nové kontroly. ` +
  `Poškozené díly se nesmějí rovnat. Ostatní závady je třeba odstranit v termínu stanoveném osobou odpovědnou ` +
  `za bezpečnost skladovacího zařízení (PRSES).\n\n` +
  `Kontrolu provedl: {{technik}}. Příští odborná kontrola: {{datum_pristi_kontroly}} (nejpozději do 12 měsíců).`;

export const EQUIPMENT_TYPE_PRESETS: EquipmentTypePreset[] = [
  {
    key: 'portable_ladder',
    name: 'Žebřík',
    description:
      'Přenosné žebříky a schůdky: opěrné, dvojité, víceúčelové, výsuvné, teleskopické, pojízdné.',
    standards: [
      'ČSN EN 131-1',
      'ČSN EN 131-2',
      'ČSN EN 131-3',
      'ČSN EN 131-4',
      'ČSN EN 131-6',
      'ČSN EN 131-7',
      'ČSN EN 14183',
    ],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'manufacturer',
        label: 'Výrobce',
        kind: 'text',
        required: true,
        suggestions: LADDER_MANUFACTURERS,
        order: 0,
      },
      { key: 'model', label: 'Model / typové označení', kind: 'text', order: 1 },
      {
        key: 'ladder_type',
        label: 'Typ žebříku',
        kind: 'select',
        required: true,
        options: [
          'Opěrný',
          'Dvojitý (štaflový)',
          'Víceúčelový',
          'Výsuvný',
          'Kloubový',
          'Teleskopický',
          'Schůdky',
          'Pojízdný s plošinou',
        ],
        order: 2,
      },
      {
        key: 'standard',
        label: 'Označení podle normy',
        kind: 'select',
        options: [
          'EN 131 Professional',
          'EN 131 Non-Professional',
          'EN 131 (před r. 2018)',
          'EN 14183 (schůdky)',
          'Bez označení',
        ],
        help: 'Od roku 2018 rozlišuje EN 131 profesionální a neprofesionální použití.',
        order: 3,
      },
      {
        key: 'material',
        label: 'Materiál',
        kind: 'select',
        options: ['Hliník', 'Ocel', 'Sklolaminát', 'Dřevo'],
        order: 4,
      },
      { key: 'sections', label: 'Počet dílů', kind: 'integer', order: 5 },
      {
        key: 'rungs',
        label: 'Počet příček / stupňů na díl',
        kind: 'integer',
        required: true,
        order: 6,
      },
      { key: 'length_m', label: 'Max. délka žebříku', kind: 'number', unit: 'm', order: 7 },
      { key: 'max_load_kg', label: 'Max. zatížení', kind: 'integer', unit: 'kg', order: 8 },
      { key: 'stabilizer', label: 'Příčný stabilizátor', kind: 'boolean', order: 9 },
      { ...common.serial(10) },
      { ...common.year(11) },
      { ...common.note(12) },
    ]),
    protocolTemplate:
      'Kontrola přenosných žebříků a schůdků byla provedena dne {{datum_kontroly}} u zákazníka {{zakaznik}}, ' +
      'provozovna {{provozovna}}, vizuálně a funkčně podle návodu výrobce a s ohledem na požadavky řady ČSN EN 131 ' +
      '(u schůdků ČSN EN 14183).\n\n' +
      'Posuzován byl zejména stav štěřin (deformace, praskliny, koroze), příček a stupňů a jejich spojení se štěřinami, ' +
      'kloubů, závěsů a západek, pojistek proti rozevření, protiskluzových patek a koncovek, příčného stabilizátoru, ' +
      'u pojízdných žebříků kol a brzd, a čitelnost označení a návodu (ČSN EN 131-3).\n\n' +
      'Zjištěné závady jsou uvedeny v protokolu u jednotlivých artiklů. Žebříky označené jako vyřazené z provozu ' +
      'nesmí být až do opravy a nové kontroly používány a je nutné je viditelně označit nebo odstranit z pracoviště.\n\n' +
      'Kontrolu provedl: {{technik}}. Příští kontrola: {{datum_pristi_kontroly}}.',
  },
  {
    key: 'fixed_ladder',
    name: 'Pevný žebřík',
    description:
      'Pevné žebříky na stavbách a ke strojním zařízením, s ochranným košem nebo zachycovačem pádu.',
    standards: ['ČSN 74 3282', 'ČSN EN ISO 14122-4'],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'purpose',
        label: 'Umístění / účel',
        kind: 'select',
        required: true,
        options: [
          'Stavba (střecha, fasáda)',
          'Strojní zařízení',
          'Komín',
          'Šachta / jímka',
          'Jiné',
        ],
        order: 0,
      },
      {
        key: 'height_m',
        label: 'Výška výstupu',
        kind: 'number',
        unit: 'm',
        required: true,
        order: 1,
      },
      {
        key: 'material',
        label: 'Materiál',
        kind: 'select',
        options: ['Ocel žárově zinkovaná', 'Ocel lakovaná', 'Nerez', 'Hliník'],
        order: 2,
      },
      {
        key: 'fall_protection',
        label: 'Ochrana proti pádu',
        kind: 'select',
        options: ['Ochranný koš', 'Zachycovač pádu na pevném vedení', 'Bez ochrany'],
        help: 'Při výšce pádu 3 m a více je ochranné zařízení povinné (ČSN EN ISO 14122-4).',
        order: 3,
      },
      { key: 'rest_platforms', label: 'Počet odpočívadel', kind: 'integer', order: 4 },
      { key: 'exit_handrails', label: 'Madla / zábradlí na výstupu', kind: 'boolean', order: 5 },
      {
        key: 'access_lock',
        label: 'Zabezpečení proti nepovolanému výstupu',
        kind: 'boolean',
        order: 6,
      },
      { key: 'manufacturer', label: 'Výrobce / dodavatel', kind: 'text', order: 7 },
      { ...common.year(8) },
      { ...common.note(9) },
    ]),
    protocolTemplate:
      'Kontrola pevných žebříků byla provedena dne {{datum_kontroly}} u zákazníka {{zakaznik}}, provozovna ' +
      '{{provozovna}}, vizuálně a funkčně s ohledem na ČSN 74 3282 (pevné kovové žebříky pro stavby), ' +
      'resp. ČSN EN ISO 14122-4 (pevné žebříky ke strojním zařízením) a návod výrobce.\n\n' +
      'Posuzován byl zejména stav štěřin a příček, kotvení ke konstrukci, koroze a poškození povrchové ochrany, ' +
      'ochranného koše nebo zachycovače pádu na pevném vedení, odpočívadel, madel a zábradlí na výstupu ' +
      'a zabezpečení proti výstupu nepovolaných osob.\n\n' +
      'Zjištěné závady jsou uvedeny v protokolu u jednotlivých artiklů. Žebříky označené jako vyřazené z provozu ' +
      'nesmí být až do opravy a nové kontroly používány a přístup k nim je nutné zamezit.\n\n' +
      'Kontrolu provedl: {{technik}}. Příští kontrola: {{datum_pristi_kontroly}}.',
  },
  {
    key: 'pallet_rack',
    name: 'Regál paletový',
    description:
      'Paletové regály s nastavitelnými nosníky obsluhované vozíky (jednostranné, oboustranné, double deep).',
    standards: ['ČSN EN 15635', 'ČSN EN 15512', 'ČSN EN 15620', 'ČSN EN 15629'],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'manufacturer',
        label: 'Výrobce',
        kind: 'text',
        required: true,
        suggestions: RACK_MANUFACTURERS,
        order: 0,
      },
      { key: 'system', label: 'Systém / typové označení', kind: 'text', order: 1 },
      {
        key: 'configuration',
        label: 'Uspořádání',
        kind: 'select',
        required: true,
        options: ['Jednostranný', 'Oboustranný', 'Double deep'],
        order: 2,
      },
      { key: 'height_mm', label: 'Výška rámu', kind: 'integer', unit: 'mm', order: 3 },
      { key: 'depth_mm', label: 'Hloubka rámu', kind: 'integer', unit: 'mm', order: 4 },
      {
        key: 'bay_width_mm',
        label: 'Šířka pole (délka nosníku)',
        kind: 'integer',
        unit: 'mm',
        order: 5,
      },
      { key: 'bays', label: 'Počet polí', kind: 'integer', order: 6 },
      { key: 'levels', label: 'Počet úrovní', kind: 'integer', order: 7 },
      { key: 'level_load_kg', label: 'Nosnost úrovně', kind: 'integer', unit: 'kg', order: 8 },
      {
        key: 'bay_load_kg',
        label: 'Nosnost pole',
        kind: 'integer',
        unit: 'kg',
        order: 9,
        defaultProduct: ['level_load_kg', 'levels'],
        help: 'Předvyplní se jako nosnost úrovně × počet úrovní; je-li na štítku nižší, přepište ji.',
      },
      ...rackCommon(10),
    ]),
    protocolTemplate: RACK_PROTOCOL(
      'paletových regálů',
      'U regálů obsluhovaných vozíky byla posouzena i poškození nárazem a dodržení tolerancí a vůlí (ČSN EN 15620).',
    ),
  },
  {
    key: 'shelving_rack',
    name: 'Regál policový',
    description: 'Policové regály pro ruční zakládání (dílny, archivy, sklady drobného materiálu).',
    standards: ['ČSN EN 15635', 'ČSN EN 15629'],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'manufacturer',
        label: 'Výrobce',
        kind: 'text',
        required: true,
        suggestions: RACK_MANUFACTURERS,
        order: 0,
      },
      { key: 'system', label: 'Systém / typové označení', kind: 'text', order: 1 },
      { key: 'height_mm', label: 'Výška', kind: 'integer', unit: 'mm', order: 2 },
      { key: 'depth_mm', label: 'Hloubka', kind: 'integer', unit: 'mm', order: 3 },
      { key: 'width_mm', label: 'Šířka pole', kind: 'integer', unit: 'mm', order: 4 },
      { key: 'shelves', label: 'Počet polic', kind: 'integer', order: 5 },
      { key: 'shelf_load_kg', label: 'Nosnost police', kind: 'integer', unit: 'kg', order: 6 },
      {
        key: 'bay_load_kg',
        label: 'Nosnost pole',
        kind: 'integer',
        unit: 'kg',
        order: 7,
        defaultProduct: ['shelf_load_kg', 'shelves'],
        help: 'Předvyplní se jako nosnost police × počet polic; je-li na štítku nižší, přepište ji.',
      },
      ...rackCommon(8),
    ]),
    protocolTemplate: RACK_PROTOCOL(
      'policových regálů',
      'Posouzeno bylo i zajištění polic a stabilita proti převržení.',
    ),
  },
  {
    key: 'cantilever_rack',
    name: 'Regál konzolový',
    description: 'Konzolové regály pro dlouhé a deskové materiály (jednostranné, oboustranné).',
    standards: ['ČSN EN 15635', 'ČSN EN 15620'],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'manufacturer',
        label: 'Výrobce',
        kind: 'text',
        required: true,
        suggestions: RACK_MANUFACTURERS,
        order: 0,
      },
      {
        key: 'configuration',
        label: 'Uspořádání',
        kind: 'select',
        required: true,
        options: ['Jednostranný', 'Oboustranný'],
        order: 1,
      },
      { key: 'height_mm', label: 'Výška sloupu', kind: 'integer', unit: 'mm', order: 2 },
      { key: 'arm_length_mm', label: 'Délka ramene', kind: 'integer', unit: 'mm', order: 3 },
      { key: 'columns', label: 'Počet sloupů', kind: 'integer', order: 4 },
      { key: 'arm_levels', label: 'Počet úrovní ramen', kind: 'integer', order: 5 },
      { key: 'arm_load_kg', label: 'Nosnost ramene', kind: 'integer', unit: 'kg', order: 6 },
      { key: 'column_load_kg', label: 'Nosnost sloupu', kind: 'integer', unit: 'kg', order: 7 },
      ...rackCommon(8),
    ]),
    protocolTemplate: RACK_PROTOCOL(
      'konzolových regálů',
      'Posouzeno bylo i upevnění a pojistky ramen, koncové zarážky ramen a dodržení tolerancí (ČSN EN 15620).',
    ),
  },
  {
    key: 'drive_in_rack',
    name: 'Regál vjezdový',
    description: 'Vjezdové (drive-in) a průjezdné (drive-through) regály s vozíkem uvnitř regálu.',
    standards: ['ČSN EN 15635', 'ČSN EN 15620'],
    defaultIntervalMonths: 12,
    fieldDefinitions: fields([
      {
        key: 'manufacturer',
        label: 'Výrobce',
        kind: 'text',
        required: true,
        suggestions: RACK_MANUFACTURERS,
        order: 0,
      },
      {
        key: 'configuration',
        label: 'Provedení',
        kind: 'select',
        required: true,
        options: ['Vjezdový (drive-in)', 'Průjezdný (drive-through)'],
        order: 1,
      },
      { key: 'height_mm', label: 'Výška', kind: 'integer', unit: 'mm', order: 2 },
      { key: 'lanes', label: 'Počet kanálů', kind: 'integer', order: 3 },
      { key: 'levels', label: 'Počet úrovní', kind: 'integer', order: 4 },
      { key: 'pallets_deep', label: 'Palet do hloubky', kind: 'integer', order: 5 },
      { key: 'pallet_load_kg', label: 'Nosnost palety', kind: 'integer', unit: 'kg', order: 6 },
      { key: 'guide_rails', label: 'Vodicí lišty pro vozík', kind: 'boolean', order: 7 },
      ...rackCommon(8),
    ]),
    protocolTemplate: RACK_PROTOCOL(
      'vjezdových regálů',
      'Posouzeny byly i zakládací lišty, vodicí profily, horní spojovací prvky a dodržení tolerancí (ČSN EN 15620).',
    ),
  },
];

export function equipmentTypePreset(key: string): EquipmentTypePreset | undefined {
  return EQUIPMENT_TYPE_PRESETS.find((preset) => preset.key === key);
}

/** Replaces `{{placeholder}}` in a protocol text; unknown placeholders are left as they are. */
export function fillProtocolTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}
