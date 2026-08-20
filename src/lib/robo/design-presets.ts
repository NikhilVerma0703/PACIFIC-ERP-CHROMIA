/**
 * Design-wise machine reference — Tool, Liquid and Powder per robot.
 *
 * Source: the plant in-charge's "Robo designs / pigments / tools" sheet.
 * Robot numbering on that sheet maps to this ERP as:
 *   robo 1 → Roycut-1 · robo 2 → Roymix · robo 3 → Roycut-2 · robo 4 → Roycut-3
 * These are the STORED machine names. On screen they read Robo1..Robo4 — see
 * MACHINE_LABEL in src/lib/robo/utils.ts. Keys here must stay the stored names.
 *
 * ── To add or change a design ────────────────────────────────────────────
 * Add one block to DESIGN_PRESETS below. Leave a machine out entirely when
 * the sheet shows "-" or "na" for it; leave a single field out when only that
 * value is blank. Nothing else in the app needs to change: the Production
 * Setup dropdown suggestions and the auto-fill both read from this list.
 *
 * A design that is NOT listed here is still perfectly valid — the operator
 * types it and fills the machine configuration by hand, exactly as before.
 */

/** Tool / liquid / powder for one robot. Omit a field the sheet leaves blank. */
export interface MachinePreset {
  toolName?: string;
  liquidName?: string;
  powderName?: string;
}

export interface DesignPreset {
  /** Canonical name, shown in the suggestions list. */
  design: string;
  /** Other spellings the plant uses for the same design. */
  aliases?: readonly string[];
  /** Keyed by machine name exactly as it appears in the Machines master. */
  machines: Readonly<Record<string, MachinePreset>>;
}

export const DESIGN_PRESETS: readonly DesignPreset[] = [
  {
    design: 'CALACATTA GOLD',
    aliases: ['calcatta gold', 'calacatta'],
    machines: {
      'Roycut-1': { toolName: 'BOAT 120, PAINTING TOOL', liquidName: 'CB-GOLD3' },
      'Roycut-2': { toolName: 'SMALL KNIFE', liquidName: 'CB-GOLD3' },
      'Roycut-3': { toolName: 'BOAT 100', liquidName: 'LG5' },
    },
  },
  {
    design: 'BELLAGIO GOLD',
    machines: {
      'Roycut-1': { toolName: 'SOMBRERO-20', liquidName: 'COSTA GOLD 703/140', powderName: 'DVCT4' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'COSTA GOLD 703/140', powderName: 'DVCT4' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'COSTA GOLD 703/140', powderName: 'DVCT4' },
    },
  },
  {
    design: 'BELLAGIO GREEN',
    machines: {
      'Roycut-1': { toolName: 'SOMBRERO-20', liquidName: 'DARK GREY', powderName: 'LIGHT GREEN' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'DARK GREY', powderName: 'DV4' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'COSTA BROWN 703', powderName: 'DVLM' },
    },
  },
  {
    design: 'BELLAGIO BLUE',
    machines: {
      'Roycut-1': { toolName: 'SOMBRERO-20', liquidName: 'DARK GREY', powderName: 'DVTQ23' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'DARK GREY', powderName: 'P1-TQB, P2-DV4' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'COSTA BROWN 703', powderName: 'DVLM' },
    },
  },
  {
    design: 'AUREATE',
    machines: {
      'Roycut-1': { toolName: 'DISCOFAT', liquidName: 'IKOS WHITE', powderName: 'DV KHAKHI2' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'SUPER MILD BROWN', powderName: 'DV KHAKHI2' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'MM-WHITE' },
    },
  },
  {
    design: 'COSTA (MILAN)',
    // Not 'costa milan': normaliseDesign already reduces the canonical name to
    // exactly that, so listing it would be a second claim on the same key.
    aliases: ['costa', 'milan'],
    machines: {
      'Roycut-1': { toolName: 'DISCOFAT', liquidName: 'COSTA BROWN 703', powderName: 'DVCT3' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'COSTA BROWN 703', powderName: 'DVCT3' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'MM-WHITE', powderName: 'DV8' },
    },
  },
  {
    design: 'BANYAN',
    machines: {
      'Roycut-1': { toolName: 'SOMBRERO-20', liquidName: 'LVBR2', powderName: 'DVCTLM2' },
      // The one design where RoyMix carries a liquid of its own.
      'Roymix': { liquidName: 'LVBR2' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'LVBR2' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'MM-WHITE' },
    },
  },
  {
    design: 'ROOTS (ARTEMIS)',
    aliases: ['roots', 'artemis'],
    machines: {
      'Roycut-1': { toolName: 'DISCOTHIN', liquidName: 'COSTA BROWN 703', powderName: 'DVCT2' },
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'COSTA BROWN 703', powderName: 'DVCT2' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'IKOS WHITE' },
    },
  },
  {
    design: 'ALABASTER NOIR (BLACK MATERIAL)',
    aliases: ['alabaster noir', 'alabaster black'],
    machines: {
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'IKOS WHITE' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'IKOS WHITE' },
    },
  },
  {
    design: 'ALABASTER (WHITE MATERIAL)',
    aliases: ['alabaster', 'alabaster white'],
    machines: {
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'DV BLACK' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: 'DV BLACK' },
    },
  },
  {
    design: 'CATERINA',
    machines: {
      'Roycut-2': { toolName: 'DISCOTHIN', liquidName: 'DARK GREY' },
      'Roycut-3': { toolName: 'DISCOTHIN', liquidName: '703/140' },
    },
  },
];

/** Names offered as dropdown suggestions — typing something else stays allowed. */
export const DESIGN_SUGGESTIONS: readonly string[] = DESIGN_PRESETS.map((p) => p.design);

/** Case, spacing and punctuation insensitive key, so "Costa (Milan)" === "costa milan". */
export function normaliseDesign(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** What one machine's three reference fields hold. Blank means "the sheet
 *  leaves this one empty", which is a value, not an absence. */
export interface PresetFields {
  toolName: string;
  liquidName: string;
  powderName: string;
}

const NO_FIELDS: PresetFields = { toolName: "", liquidName: "", powderName: "" };

/**
 * What the reference sheet says this design puts on this machine — with ""
 * for every field it leaves blank, and "" across the board for a machine the
 * design does not use at all.
 *
 * THE BLANKS ARE THE POINT. The sheet is a complete statement per design: it
 * lists all four robots and writes "-" or "na" where one is not used, so a
 * design does not merely add values, it says what every machine carries.
 *
 * Reading a missing entry as "leave whatever is there" is what produced the
 * wrong mappings on the setup card. Pick BELLAGIO GOLD, then correct the
 * design to BANYAN: the sheet gives BANYAN no powder on Robo3, and BELLAGIO
 * GOLD's DVCT4 stayed sitting there. Switch to ALABASTER, whose sheet row uses
 * neither Robo1 nor Robo2, and the whole of the previous design's Robo1 row —
 * tool, liquid and powder — stayed. The card then showed a mixture of two
 * designs, and it was saved as though it were the recipe for one.
 *
 * Program name, target cycle time and roller height are NOT here and are never
 * cleared by a design change: they vary run to run and the sheet does not
 * cover them.
 */
export function presetFieldsFor(preset: DesignPreset | null | undefined, machineName: string): PresetFields {
  const mp = preset?.machines?.[machineName];
  if (!mp) return NO_FIELDS;
  return {
    toolName: mp.toolName ?? "",
    liquidName: mp.liquidName ?? "",
    powderName: mp.powderName ?? "",
  };
}

/** The reference row for a typed design name, or null when there isn't one. */
export function findDesignPreset(name: string): DesignPreset | null {
  const key = normaliseDesign(name);
  if (!key) return null;
  for (const preset of DESIGN_PRESETS) {
    if (normaliseDesign(preset.design) === key) return preset;
    for (const alias of preset.aliases ?? []) {
      if (normaliseDesign(alias) === key) return preset;
    }
  }
  return null;
}
