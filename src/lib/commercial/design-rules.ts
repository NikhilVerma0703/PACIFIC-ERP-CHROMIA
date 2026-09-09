// The design master (answers 13 and 20; round two, answers 14 and 15) — the
// PURE half. What shade a design name suggests before anyone has confirmed it,
// how a customer code is normalised, the colour a design carries (L*a*b* read
// off the sample, the hex derived from it or typed over it), how many hours of
// cleaning a changeover costs, and which rows a seed inserts. Run by
// tests/commercialDesignCodes.test.ts under node --test.
//
// IMPORT-FREE, deliberately. The design-code routes, the production-request
// routes and the planning board import this; nothing here imports them back.

export const SHADES = ["LIGHT", "MEDIUM", "DARK"] as const;
export type Shade = (typeof SHADES)[number];

/** A shade from a body or a column, or null for anything that is not one. */
export function parseShade(v: unknown): Shade | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (SHADES as readonly string[]).includes(s) ? (s as Shade) : null;
}

/**
 * The words in a design name that say which end of the palette it sits at.
 * The list is the owner's from DESIGN.md §8 plus the spellings finished goods
 * actually uses ("gray", "statuario", "graphite"). Matched as substrings of
 * the lower-cased name rather than whole words, because the yard writes
 * "Greystone" and "Whitehaven" and a first guess that missed those would be
 * MEDIUM for no reason — the guess is unconfirmed either way, and the editor
 * exists to correct it.
 */
export const LIGHT_WORDS = ["white", "bianco", "carrara", "calacatta", "ivory", "cream", "statuario"] as const;
export const DARK_WORDS = ["black", "nero", "grey", "gray", "charcoal", "dark", "brown", "graphite"] as const;

/**
 * A first-guess shade from the name. A name that says both ("Black & White")
 * says nothing about which end dominates, so it lands in the middle rather
 * than on whichever word happened to be listed first. Blank is MEDIUM too:
 * the queue rule treats an unknown shade as MEDIUM, and the seed must not
 * write a null that the editor then shows as "no guess" beside a guess.
 */
export function guessShade(designName: unknown): Shade {
  const name = typeof designName === "string" ? designName.toLowerCase() : "";
  if (!name.trim()) return "MEDIUM";
  const light = LIGHT_WORDS.some((w) => name.includes(w));
  const dark = DARK_WORDS.some((w) => name.includes(w));
  if (light && !dark) return "LIGHT";
  if (dark && !light) return "DARK";
  return "MEDIUM";
}

/** The customer code as stored: trimmed, upper-cased, null when blank. Two
 *  designs may not share one (the column is unique), and "pes-01" typed on
 *  one row and "PES-01" on another would slip past that as two codes. */
export function normaliseDesignCode(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  return s ? s : null;
}

/** The design name as a key: trimmed, never empty. The column is the primary
 *  key, so a trailing space would make a second master row for one design. */
export function normaliseDesignName(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ─────────────────────── the colour (round two, answer 15) ───────────────────
//
// The owner reads L*a*b* off the sample with a hand-held spectrophotometer and
// the ERP derives the swatch from it; a hex typed by hand overrules the derived
// one and is what decides. L* is also what decides an abrupt changeover
// (answer 14), which is why the conversion lives here beside the queue rule.
//
// D65 / sRGB, and NOT a colour-management library, for three reasons. The
// instrument reports L*a*b* under D65 (the ISO 3664 / graphic-arts default the
// stone trade quotes), the swatch is drawn by a browser, and a browser's CSS
// hex IS sRGB — so the pair of white points a managed pipeline would let you
// choose is already fixed at both ends, and there is exactly one right answer.
// A library (icc profiles, chromatic adaptation, gamut mapping) would add a
// dependency, a build step and a rendering intent to argue about, and would
// still have to clamp out-of-gamut colours the way the four lines below do.
// This module is import-free on purpose; a colour library cannot be.

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A typed hex as stored: "#RRGGBB", upper case, three digits expanded. Null
 *  for anything that is not a hex — the caller decides whether that is an
 *  error or simply "no colour". */
export function normaliseHex(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = HEX_RE.exec(s);
  if (!m) return null;
  const d = m[1];
  const six = d.length === 3 ? d[0] + d[0] + d[1] + d[1] + d[2] + d[2] : d;
  return `#${six.toUpperCase()}`;
}

export interface Rgb { r: number; g: number; b: number }
export interface Lab { L: number; a: number; b: number }

/** The D65 white point in the CIE 1931 2° observer, the one the instrument
 *  reports against. */
const WHITE = { X: 95.047, Y: 100, Z: 108.883 };
const D = 6 / 29;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** L*a*b* → linear XYZ: the standard piecewise inverse, linear near black so
 *  the cube root does not explode the numbers a dark sample carries. */
function labToXyz(L: number, a: number, b: number): { X: number; Y: number; Z: number } {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t > D ? t * t * t : 3 * D * D * (t - 4 / 29));
  return { X: WHITE.X * inv(fx), Y: WHITE.Y * inv(fy), Z: WHITE.Z * inv(fz) };
}

/** Linear light → sRGB's transfer function (IEC 61966-2-1): the 12.92 line
 *  near black, the 2.4 power curve above it. */
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const ungamma = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * L*a*b* (D65) → sRGB, 0..255, CLAMPED. A sample can sit outside the sRGB
 * gamut — a saturated red quartz reads a* far past anything a monitor can
 * show — and clamping is the honest answer for a swatch: the nearest colour
 * the screen has. It is never fed back into L*, so nothing is lost.
 */
export function labToRgb(L: unknown, a: unknown, b: unknown): Rgb {
  const l = Number(L) || 0, aa = Number(a) || 0, bb = Number(b) || 0;
  const { X, Y, Z } = labToXyz(l, aa, bb);
  const x = X / 100, y = Y / 100, z = Z / 100;
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ].map((c) => Math.round(clamp(gamma(clamp(c, 0, 1)), 0, 1) * 255));
  return { r: lin[0], g: lin[1], b: lin[2] };
}

const hh = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** The swatch a reading derives: "#RRGGBB", upper case, always six digits. */
export function labToHex(L: unknown, a: unknown, b: unknown): string {
  const { r, g, b: bl } = labToRgb(L, a, b);
  return `#${hh(r)}${hh(g)}${hh(bl)}`;
}

/**
 * A hand-typed hex back to L*a*b* (D65), so a design whose colour was typed
 * rather than measured still carries the L* the sequencing rule reads
 * (answer 14). Rounded to two decimals — the column is Decimal(6,2) — and
 * null for anything that is not a hex.
 */
export function hexToLab(hex: unknown): Lab | null {
  const h = normaliseHex(hex);
  if (!h) return null;
  const [r, g, b] = [1, 3, 5].map((i) => ungamma(parseInt(h.slice(i, i + 2), 16) / 255));
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100;
  const Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) * 100;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) * 100;
  const f = (t: number) => (t > D * D * D ? Math.cbrt(t) : t / (3 * D * D) + 4 / 29);
  const fx = f(X / WHITE.X), fy = f(Y / WHITE.Y), fz = f(Z / WHITE.Z);
  // A neutral grey lands a* and b* on a negative zero, which stores and
  // prints as "-0"; there is no such reading.
  const r2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
  return { L: r2(116 * fy - 16), a: r2(500 * (fx - fy)), b: r2(200 * (fy - fz)) };
}

/** The ranges the columns and the instrument agree on: L* is a percentage of
 *  white, a* and b* are the signed opponent axes as one byte each. */
export const LAB_RANGE = { L: [0, 100], a: [-128, 127], b: [-128, 127] } as const;

export function labFieldLabel(field: "labL" | "labA" | "labB"): string {
  return field === "labL" ? "L*" : field === "labA" ? "a*" : "b*";
}

/** One L*a*b* number from a body: null when cleared, refused when it is not a
 *  number or sits outside the axis — a stored 300 would derive a black swatch
 *  and sequence the queue as if the design were dark. */
export function parseLabValue(field: "labL" | "labA" | "labB", v: unknown): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return { ok: false, reason: `${labFieldLabel(field)} must be a number` };
  const [lo, hi] = LAB_RANGE[field === "labL" ? "L" : field === "labA" ? "a" : "b"];
  if (n < lo || n > hi) return { ok: false, reason: `${labFieldLabel(field)} must be between ${lo} and ${hi}` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** What a design's colour looks like wherever one is read: the master row
 *  itself, a queue row carrying the master's L*, or a dialog's draft. Every
 *  field is optional and `unknown`, because a Prisma Decimal, a form string
 *  and a JSON number all arrive here. */
export interface DesignColourLike {
  design?: unknown;
  shade?: unknown;
  colourName?: unknown;
  hex?: unknown;
  labL?: unknown;
  labA?: unknown;
  labB?: unknown;
}

/** A side of a changeover: the shade word the queue stored, or the design's
 *  colour row. Both are accepted so a caller that has only the label still
 *  gets an answer (answer 14: "fall back to the LIGHT/MEDIUM/DARK label"). */
export type ChangeoverSide = string | DesignColourLike | null | undefined;

const isColour = (v: ChangeoverSide): v is DesignColourLike => typeof v === "object" && v !== null;

/** The L* on file, or null: a Decimal, a number or a numeric string, inside
 *  0..100. Anything else is "no reading", never a silent zero — zero is black. */
export function labLOf(side: ChangeoverSide): number | null {
  if (!isColour(side)) return null;
  const raw = side.labL;
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < LAB_RANGE.L[0] || n > LAB_RANGE.L[1]) return null;
  return n;
}

/** The shade word on file, or null. */
export function shadeOf(side: ChangeoverSide): Shade | null {
  return parseShade(isColour(side) ? side.shade : side);
}

export interface PlanningSettingsLike {
  cleaningHoursDefault: number;
  cleaningHoursAbrupt: number;
  /** Round two, answer 14: at or below darkMaxL is dark, at or above
   *  lightMinL is light, and the gap between them is the ordinary run. */
  darkMaxL: number;
  lightMinL: number;
}

/** The owner's figures, used whenever a setting is missing or nonsense. */
export const DARK_MAX_L = 30;
export const LIGHT_MIN_L = 75;

/** The two thresholds, guarded: a dark ceiling at or above the light floor
 *  would make every design both, so a pair like that falls back to 30 / 75
 *  rather than flagging the whole queue. settings-rules refuses to SAVE such
 *  a pair; this is the belt for a row written before that rule existed. */
export function lightnessThresholds(planning?: Partial<PlanningSettingsLike> | null): { dark: number; light: number } {
  const dark = Number(planning?.darkMaxL);
  const light = Number(planning?.lightMinL);
  const ok = Number.isFinite(dark) && Number.isFinite(light) && dark >= 0 && light <= 100 && dark < light;
  return ok ? { dark, light } : { dark: DARK_MAX_L, light: LIGHT_MIN_L };
}

/**
 * Which end of the palette a design sits at (round two, answer 14). The
 * MEASURED L* decides when there is one: at or below darkMaxL is DARK, at or
 * above lightMinL is LIGHT, between them MEDIUM. With no reading the
 * LIGHT / MEDIUM / DARK label stands in, and a design with neither is MEDIUM —
 * "sudden very dark to super white" is a claim about a design nobody has
 * measured or classified, and we do not make it.
 */
export function lightnessBand(side: ChangeoverSide, planning?: Partial<PlanningSettingsLike> | null): Shade {
  const L = labLOf(side);
  if (L === null) return shadeOrMedium(shadeOf(side));
  const { dark, light } = lightnessThresholds(planning);
  if (L <= dark) return "DARK";
  if (L >= light) return "LIGHT";
  return "MEDIUM";
}

/** How a changeover reads on screen and in the log: "Alabaster Noir L* 12"
 *  where the design was measured, "Midnight Black (dark)" where only the label
 *  is on file, the bare name where neither is. */
export function colourLabel(design: unknown, side: ChangeoverSide): string {
  const name = normaliseDesignName(design) ?? (isColour(side) ? normaliseDesignName(side.design) ?? "" : "");
  const L = labLOf(side);
  if (L !== null) return `${name} L* ${Number(L.toFixed(1))}`.trim();
  const shade = shadeOf(side);
  return shade ? `${name} (${shade.toLowerCase()})`.trim() : name;
}

/** The hours the settings say, or the owner's 3 / 6 when a setting is not a
 *  positive number — a blank override must not schedule zero hours of cleaning. */
function hours(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** An unknown shade counts as MEDIUM: a design nobody has classified yet is
 *  neither an abrupt jump nor a reason to skip the ordinary clean. */
export function shadeOrMedium(v: unknown): Shade {
  return parseShade(v) ?? "MEDIUM";
}

/**
 * Answer 13, re-read as round two's answer 14: a changeover is abrupt when
 * the design coming off is DARK and the one going on is LIGHT. What DARK and
 * LIGHT mean is now a DISTANCE, not a category — the measured L* against the
 * two settings thresholds — and the stored label only stands in for a design
 * nobody has measured (lightnessBand). LIGHT → DARK stays the slow direction
 * the owner asked for; MEDIUM either way is the ordinary changeover.
 *
 * Both sides accept either a shade word or a colour row, so a caller holding
 * only the label still gets the old answer.
 */
export function isAbruptJump(prev: ChangeoverSide, next: ChangeoverSide, planning?: Partial<PlanningSettingsLike> | null): boolean {
  return lightnessBand(prev, planning) === "DARK" && lightnessBand(next, planning) === "LIGHT";
}

/**
 * Cleaning hours for a row given the row before it in the queue: the abrupt
 * figure on a dark → light changeover, else the ordinary one. No previous row
 * means the machine is coming off whatever ran last, which the queue does not
 * know — so the ordinary clean, never the abrupt one.
 */
export function cleaningHoursFor(prev: ChangeoverSide, next: ChangeoverSide, planning?: Partial<PlanningSettingsLike> | null): number {
  const ordinary = hours(planning?.cleaningHoursDefault, 3);
  const abrupt = hours(planning?.cleaningHoursAbrupt, 6);
  if (prev === null || prev === undefined) return ordinary;
  return isAbruptJump(prev, next, planning) ? abrupt : ordinary;
}

export interface DesignCodePatch {
  code?: string | null;
  shade?: Shade | null;
  shadeConfirmed?: boolean;
  notes?: string | null;
  colourName?: string | null;
  hex?: string | null;
  labL?: number | null;
  labA?: number | null;
  labB?: number | null;
}

export const LAB_FIELDS = ["labL", "labA", "labB"] as const;

/**
 * The fields a PUT may change, taken only when the body names them, so a
 * body that sends `{ code: "PES-01" }` does not clear the shade. A shade that
 * is not LIGHT / MEDIUM / DARK is refused rather than stored as null, because
 * "null" in that column means "not yet guessed" and the queue would silently
 * read it as MEDIUM. A hex that is not a hex and an L*a*b* outside its axis
 * are refused the same way.
 *
 * A body that types a hex and names no L*a*b* has its reading BACK-FILLED
 * from that hex (round two, answer 15: the typed hex wins, and L* is what
 * sequences the queue — so a colour typed by hand must still leave a number
 * behind, or the design silently drops back to its guessed label). The
 * MIRROR holds too: a body that sends the three axes and no hex derives the
 * swatch from them, so a re-read never leaves the previous shade's hex on the
 * row beside the new numbers.
 */
export function designCodePatch(body: Record<string, unknown>): { ok: true; patch: DesignCodePatch } | { ok: false; reason: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: DesignCodePatch = {};
  if (has("code")) patch.code = normaliseDesignCode(body.code);
  if (has("shade")) {
    if (body.shade === null || body.shade === "") patch.shade = null;
    else {
      const s = parseShade(body.shade);
      if (!s) return { ok: false, reason: `Shade must be one of ${SHADES.join(", ")}` };
      patch.shade = s;
    }
  }
  if (has("shadeConfirmed")) patch.shadeConfirmed = body.shadeConfirmed === true || body.shadeConfirmed === "true";
  if (has("notes")) {
    const n = body.notes === null || body.notes === undefined ? "" : String(body.notes).trim();
    patch.notes = n ? n : null;
  }
  if (has("colourName")) {
    const n = body.colourName === null || body.colourName === undefined ? "" : String(body.colourName).trim();
    patch.colourName = n ? n : null;
  }
  if (has("hex")) {
    if (body.hex === null || body.hex === undefined || body.hex === "") patch.hex = null;
    else {
      const h = normaliseHex(body.hex);
      if (!h) return { ok: false, reason: "The hex must read like #F2EFE9" };
      patch.hex = h;
    }
  }
  for (const f of LAB_FIELDS) {
    if (!has(f)) continue;
    const parsed = parseLabValue(f, body[f]);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    patch[f] = parsed.value;
  }
  // The typed hex leaves a reading behind (answer 15). Only when the body
  // named none itself: a dialog that sends all five fields has already done
  // this, and a body clearing the hex must not invent an L*a*b* for null.
  if (patch.hex && !LAB_FIELDS.some((f) => has(f))) {
    const lab = hexToLab(patch.hex);
    if (lab) { patch.labL = lab.L; patch.labA = lab.a; patch.labB = lab.b; }
  } else if (!has("hex") && LAB_FIELDS.some((f) => has(f))) {
    // The MIRROR of the same answer: a reading sent on its own derives the
    // swatch. Without this a lab-only save (an instrument re-read typed into
    // the three boxes) left the OLD hex sitting beside the new numbers — and
    // the typed hex is what decides, so the stale swatch would have gone on
    // deciding. Only when all three axes end up non-null: two axes and a
    // missing one derive nothing, and a body clearing an axis is clearing the
    // reading, not asking for a colour.
    const { labL: L, labA: a, labB: b } = patch;
    if (L !== null && L !== undefined && a !== null && a !== undefined && b !== null && b !== undefined) {
      patch.hex = labToHex(L, a, b);
    }
  }
  if (!Object.keys(patch).length) return { ok: false, reason: "Nothing to change" };
  return { ok: true, patch };
}

export interface SeedRow {
  design: string;
  shade: Shade;
  shadeConfirmed: false;
}

/**
 * The master rows a seed inserts: one per distinct finished-goods design name
 * not already in the master, shade guessed, unconfirmed. Names are compared
 * trimmed and case-insensitively in BOTH directions — "Carrara Royale" in the
 * master and "CARRARA ROYALE" in stock are one design, and the seed must not
 * create the second row that the alias table exists to prevent. The first
 * spelling seen is the one written.
 *
 * NO COLOUR (round two, answer 15). The shade stays a guess from the name;
 * the colour name, the L*a*b* and the hex are left empty, because they are
 * read off a physical sample and a seeded guess at them would look exactly
 * like a measurement on the screen that decides the queue's cleaning hours.
 */
export function seedRows(existingDesigns: ReadonlyArray<string | null | undefined>, stockDesigns: ReadonlyArray<string | null | undefined>): SeedRow[] {
  const seen = new Set<string>();
  for (const d of existingDesigns) {
    const s = normaliseDesignName(d);
    if (s) seen.add(s.toLowerCase());
  }
  const out: SeedRow[] = [];
  for (const d of stockDesigns) {
    const s = normaliseDesignName(d);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ design: s, shade: guessShade(s), shadeConfirmed: false });
  }
  return out;
}

/** The master row for a design, matched trimmed and case-insensitively, so a
 *  request raised as "carrara royale" still finds "Carrara Royale"'s shade. */
export function findDesignRow<T extends { design: string }>(rows: ReadonlyArray<T>, design: unknown): T | null {
  const want = (normaliseDesignName(design) ?? "").toLowerCase();
  if (!want) return null;
  return rows.find((r) => r.design.trim().toLowerCase() === want) ?? null;
}
