import { fieldDefinitionsSchema, type FieldDefinition } from './equipment-fields.js';

/**
 * Library of equipment types derived from the relevant standards and common manufacturers.
 * Used for demo data and offered in the administration ("Přidat z knihovny"); every type can be
 * edited afterwards. Protocol texts ("Pokyny k provádění kontrol") are the inspection company's
 * own texts from its protocol form (docs/vzory); `fixed_ladder` has none there and is a draft.
 *
 * Format of protocol texts (see `protocolTextHtml`): `# ` heading, `• ` item, indented `• `
 * sub-item. Placeholders: {{zakaznik}}, {{provozovna}}, {{datum_kontroly}}, {{technik}},
 * {{datum_pristi_kontroly}}.
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

const RACK_PROTOCOL = `# Regály
• Kontrola regálů je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací regálu (návodem výrobce) a ČSN 26 9030, ČSN EN 15629 a ČSN EN 15635.
• Kontrola regálů zahrnuje:
  • kontrolu mechanického poškození (zejména u sloupků a nosníků),
  • kontrolu svislosti, vodorovnosti a stability (vychýlení sloupků),
  • vizuální kontrolu (trhliny svárů, komponent, zejména patky sloupků a připojení nosníků ke sloupkům),
  • kontrolu stavu podlahy,
  • kontrolu reálného stavu regálu v souladu s provozní dokumentací,
  • kontrola způsobu používání (způsob uložení předmětů – rozměry, stabilita, přetěžování, opírání předmětů o regál, označení).`;

const LADDER_PROTOCOL = `# Žebříky a schůdky
• Kontrola žebříků a schůdků je provedena dle nařízení vlády č. 362/2005 Sb. a nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací žebříku a schůdků (návodem výrobce) a ČSN EN 131-X.
• Kontrola žebříků a schůdků zahrnuje:
  • vizuální kontrolu (kompletnost, celistvost, označení, praskliny, deformace, opotřebení, nátěry, uvolněné části nebo jiná viditelná poškození),
  • zkouška pojistných prvků a kloubových závěsů funkčnosti bezpečnostních prvků (vymezovač rozevření – dvojité žebříky, blokovací zařízení – výsuvné žebříky),
  • zkouška pevnosti, zkouška průhybu a bočního průhybu, zkouška dolních konců, vertikální zatížení příčlí, stupadel a plošin, zkouška patek, zkouška plošiny, zkouška madla/zábradlí, zkouška vysunutí,
  • zkouška stability (žebřík se postaví dolními konci postranic na rovnou podložku a horními konci se opře o kolmou stěnu, a přitom musí dolní i horní konce postranic přiléhat k opěrným plochám – jednoduchý žebřík, při úplném rozevření žebříku se musí dosáhnout dokonalého styku všech postranic s opěrnou rovnou podložkou – dvojitý žebřík nebo schůdky, boční výkyv).`;

/** Draft in the style of the form (the form has no text for fixed ladders). */
const FIXED_LADDER_PROTOCOL = `# Pevné žebříky
• Kontrola pevných žebříků je provedena dle nařízení vlády č. 362/2005 Sb. a nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací žebříku (návodem výrobce) a ČSN 74 3282, popř. ČSN EN ISO 14122-4.
• Kontrola pevných žebříků zahrnuje:
  • vizuální kontrolu (kompletnost, celistvost, deformace, praskliny, koroze, poškození povrchové ochrany),
  • kontrolu kotvení ke stavební konstrukci,
  • kontrolu ochranného koše nebo zachycovače pádu na pevném vedení,
  • kontrolu odpočívadel, madel a zábradlí na výstupu,
  • kontrolu zabezpečení proti výstupu nepovolaných osob,
  • kontrolu identifikačního štítku (označení).`;

const SECTIONAL_DOOR_PROTOCOL = `# Sekční vrata
• Kontrola sekčních vrat je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací sekčních vrat (návodem výrobce).
• Kontrola sekčních vrat zahrnuje:
  • kontrolu mechanického poškození (sekční panely, vodicí a těsnící lišty),
  • kontrola vodících kolejnic (stav spojů šroubových a popř. nýtových, stav kotvení, stav koncových dorazů),
  • kontrola pružin (stav napnutí, stav lankového navíjení – lanka, kladky, navíječe; kontrola pojistek),
  • kontrola pohonu (stav napnutí řetězu nebo řemenu, stav ovládacích a bezpečnostních prvků),
  • kontrola integrovaných dveří (poškození, kontrola pohybu v pantech a zavírání, dveřní mechanismy),
  • funkční zkouška a zhodnocení celkového stavu (např. znečištění).`;

const SCAFFOLD_PROTOCOL = `# Pojízdné lešení
• Kontrola pojízdného lešení je provedena dle nařízení vlády č. 362/2005 Sb., a to v souladu s průvodní dokumentací pojízdného lešení (návod výrobce).
• Kontrola pojízdného lešení zahrnuje:
  • vizuální kontrolu (deformace, opotřebení, poškození, trhliny a nalomení, kompletnost),
  • kontrolu funkčnosti bezpečnostních prvků (zábradlí, rychlouzávěry, brzdy, kolečka),
  • kontrolu identifikačního štítku (označení),
  • kontrola stavu provozní dokumentace.`;

const PPE_PROTOCOL = `# Osobní ochranné pracovní prostředky
• Kontrola osobních ochranných pracovních prostředků (OOPP) je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací osobních ochranných pracovních prostředků (návod výrobce) a ČSN EN 378-3.
• Kontrola osobních ochranných pracovních prostředků zahrnuje:
  • vizuální kontrolu (opotřebení, poškození, kompletnost),
  • kontrolu funkčnosti a ochranných vlastností,
  • kontrola stavu provozní dokumentace.`;

const PALLET_TRUCK_PROTOCOL = `# Paletové vozíky
• Kontrola paletových vozíků je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací paletových vozíků (návod výrobce).
• Kontrola paletových vozíků zahrnuje:
  • kontrola opotřebení všech dílů (opotřebení, poškození, kompletnost, únik oleje),
  • kontrolu funkčnosti (regulace, řízení),
  • kontrola stavu pojezdových kol a náprav,
  • kontrola identifikačního štítku (označení),
  • kontrola stavu provozní dokumentace.`;

const HAND_TRUCK_PROTOCOL = `# Ruční vozíky a rudly
• Kontrola ručních vozíků a rudlů je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací ručních vozíků a rudlů (návod výrobce).
• Kontrola ručních vozíků a rudlů zahrnuje:
  • kontrola opotřebení všech dílů (opotřebení, poškození, dotažení šroubových spojů, kompletnost),
  • kontrolu funkčnosti (řízení, brzda – pokud je jí ruční vozík nebo rudl vybaven),
  • kontrola stavu kol,
  • kontrola identifikačního štítku (označení),
  • kontrola označení nosnosti,
  • kontrola stavu provozní dokumentace.`;

const RAIL_TROLLEY_PROTOCOL = `# Kolejové vozíky
• Kontrola kolejových vozíků je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací kolejových vozíků (návod výrobce).
• Kontrola kolejových vozíků zahrnuje:
  • kontrola opotřebení všech dílů (opotřebení, poškození, kompletnost, únik oleje),
  • kontrolu funkčnosti (dorazy, brzdy, připojovací čepy, úchopy pro ruční tlačení, úchopy pro fixaci převáženého materiálu),
  • kontrola stavu pojezdových kol a náprav,
  • kontrola identifikačního štítku (označení),
  • kontrola stavu provozní dokumentace.`;

const ROLL_CONTAINER_PROTOCOL = `# Rollkontejnery s pojízdným rámem a mřížovými stěnami ze stabilních pravoúhlých trubek
• Kontrola rollkontejnerů dle aktuálního seznamu je provedena dle nařízení vlády č. 378/2001 Sb.
• Kontrola rollkontejnerů zahrnuje:
  • kontrola opotřebení všech dílů (opotřebení, poškození, dotažení šroubových spojů, kompletnost),
  • kontrolu funkčnosti (řízení, brzda – pokud je jí rollkontejner vybaven),
  • kontrola stavu koleček,
  • kontrola identifikačního štítku (označení),
  • kontrola stavu provozní dokumentace.`;

const OTHER_PROTOCOL = `# Technické vybavení – ostatní
• Kontrola technického vybavení dle aktuálního seznamu provozovatele (zahrnuje ruční nářadí, nábytek – stoly, židle, skříně, police a další vybavení) je provedena dle nařízení vlády č. 101/2005 Sb.
• Kontrola technického vybavení zahrnuje:
  • vizuální kontrolu rozhodujících vlastností k zajištění bezpečnosti, tj. úroveň bezpečnosti a spolehlivosti zařízení a vybavení bez zjevného poškození tak, aby technické vybavení pracovišť bylo nadále bezpečné a provozuschopné (opotřebení, viditelná poškození, funkčnost a úplnost ovládacích nebo úchopových prvků).`;

/** Fields of the simpler equipment types: manufacturer, model, optional capacity, serial, year. */
const basicFields = (capacity?: { key: string; label: string; unit: string }) =>
  fields([
    { key: 'manufacturer', label: 'Výrobce', kind: 'text', order: 0 },
    { key: 'model', label: 'Model / typové označení', kind: 'text', order: 1 },
    ...(capacity ? [{ ...capacity, kind: 'integer', order: 2 }] : []),
    { ...common.serial(3) },
    { ...common.year(4) },
    { ...common.note(5) },
  ]);

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
    protocolTemplate: LADDER_PROTOCOL,
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
    protocolTemplate: FIXED_LADDER_PROTOCOL,
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
    protocolTemplate: RACK_PROTOCOL,
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
    protocolTemplate: RACK_PROTOCOL,
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
    protocolTemplate: RACK_PROTOCOL,
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
    protocolTemplate: RACK_PROTOCOL,
  },
  {
    key: 'sectional_door',
    name: 'Sekční vrata',
    description: 'Sekční vrata s ručním nebo elektrickým pohonem, včetně integrovaných dveří.',
    standards: ['ČSN EN 13241', 'ČSN EN 12604', 'ČSN EN 12453'],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields(),
    protocolTemplate: SECTIONAL_DOOR_PROTOCOL,
  },
  {
    key: 'mobile_scaffold',
    name: 'Pojízdné lešení',
    description: 'Pojízdná lešení (věže) z prefabrikovaných dílů.',
    standards: ['ČSN EN 1004-1'],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields({ key: 'working_height_m', label: 'Pracovní výška', unit: 'm' }),
    protocolTemplate: SCAFFOLD_PROTOCOL,
  },
  {
    key: 'ppe',
    name: 'OOPP',
    description: 'Osobní ochranné pracovní prostředky (např. proti pádu z výšky).',
    standards: [],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields(),
    protocolTemplate: PPE_PROTOCOL,
  },
  {
    key: 'pallet_truck',
    name: 'Paletový vozík',
    description: 'Ruční paletové vozíky (nízkozdvižné, vysokozdvižné, s váhou).',
    standards: ['ČSN EN ISO 3691-5'],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields({ key: 'capacity_kg', label: 'Nosnost', unit: 'kg' }),
    protocolTemplate: PALLET_TRUCK_PROTOCOL,
  },
  {
    key: 'hand_truck',
    name: 'Ruční vozík / rudl',
    description: 'Plošinové a policové ruční vozíky, rudly.',
    standards: [],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields({ key: 'capacity_kg', label: 'Nosnost', unit: 'kg' }),
    protocolTemplate: HAND_TRUCK_PROTOCOL,
  },
  {
    key: 'rail_trolley',
    name: 'Kolejový vozík',
    description: 'Vozíky pojíždějící po kolejnicích.',
    standards: [],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields({ key: 'capacity_kg', label: 'Nosnost', unit: 'kg' }),
    protocolTemplate: RAIL_TROLLEY_PROTOCOL,
  },
  {
    key: 'roll_container',
    name: 'Rollkontejner',
    description: 'Rollkontejnery s pojízdným rámem a mřížovými stěnami.',
    standards: [],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields({ key: 'capacity_kg', label: 'Nosnost', unit: 'kg' }),
    protocolTemplate: ROLL_CONTAINER_PROTOCOL,
  },
  {
    key: 'other_equipment',
    name: 'Technické vybavení – ostatní',
    description: 'Ruční nářadí, nábytek (stoly, židle, skříně, police) a další vybavení pracovišť.',
    standards: [],
    defaultIntervalMonths: 12,
    fieldDefinitions: basicFields(),
    protocolTemplate: OTHER_PROTOCOL,
  },
];

export function equipmentTypePreset(key: string): EquipmentTypePreset | undefined {
  return EQUIPMENT_TYPE_PRESETS.find((preset) => preset.key === key);
}

/** Replaces `{{placeholder}}` in a protocol text; unknown placeholders are left as they are. */
export function fillProtocolTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}
