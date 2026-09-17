"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useRouter } from "next/navigation";

const BRAND = "#0f4c5c";

export function DailyBars({ data }: { data: { day: string; count: number }[] }) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} width={36} />
        <Tooltip />
        <Bar dataKey="count" fill={BRAND} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * THE THICKNESS BANDS A BAR CAN BE SPLIT INTO, in the order they stack.
 *
 * Fixed rather than derived from the data, for two reasons: 2 cm is always the
 * left-hand block whatever a particular batch happens to hold, so two batches
 * can be compared at a glance; and "not recorded" is always last, so the part
 * of a bar nobody has measured sits at the end where it reads as a gap rather
 * than as a quantity.
 */
export const THICKNESS_BANDS = ["2 cm", "3 cm", "Other", "not recorded"] as const;
export type ThicknessBand = (typeof THICKNESS_BANDS)[number];

/** One block of a split bar. Darker to lighter, so the eye reads the stack in
 *  the same order every time; "not recorded" is grey because it is an absence,
 *  not a thickness. */
const BAND_SHADE: Record<ThicknessBand, number> = {
  "2 cm": 1, "3 cm": 0.72, "Other": 0.48, "not recorded": 0,
};

/** The grade's own colour, lightened per band. A grade keeps its meaning —
 *  green is still an A, amber still a C — and the bands read as shades of it
 *  rather than as four unrelated colours that would fight the grade scale. */
function shade(hex: string, amount: number): string {
  if (amount === 0) return "#cbd5e1";
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * (1 - amount));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function HBars({
  data,
  colorFor,
  links,
}: {
  /**
   * `segments` SPLITS THE BAR WITHOUT CHANGING ITS LENGTH. A row that carries
   * them is drawn as one stacked bar whose blocks sum to `count`, so the chart
   * still answers "how many of this grade" at a glance and now also answers
   * "of what thickness" without a second chart beside it.
   *
   * Absent, the bar is drawn exactly as it always was — every other caller of
   * this component is untouched.
   */
  data: { label: string; count: number; segments?: Partial<Record<ThicknessBand, number>> }[];
  colorFor?: (label: string) => string;
  links?: Record<string, string>;
}) {
  const router = useRouter();
  const onBar = (d: { label?: string; payload?: { label?: string } }) => {
    const label = d?.label ?? d?.payload?.label;
    const u = label ? links?.[label] : undefined;
    if (u) router.push(u);
  };
  if (!data.length) return null;

  // Only the bands actually present are drawn, so a batch that is entirely
  // 3 cm gets one block and no empty legend entries for thicknesses it has
  // never held.
  const bands = THICKNESS_BANDS.filter((b) => data.some((d) => (d.segments?.[b] ?? 0) > 0));
  const stacked = bands.length > 0;
  const rows = stacked
    ? data.map((d) => ({ ...d, ...Object.fromEntries(bands.map((b) => [b, d.segments?.[b] ?? 0])) }))
    : data;

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
          <Tooltip />
          {stacked ? (
            bands.map((band) => (
              <Bar key={band} dataKey={band} stackId="t" onClick={onBar}
                   radius={band === bands[bands.length - 1] ? [0, 3, 3, 0] : undefined}>
                {rows.map((d, i) => (
                  <Cell key={i} fill={shade(colorFor ? colorFor(d.label) : BRAND, BAND_SHADE[band])}
                        cursor={links ? "pointer" : undefined} />
                ))}
              </Bar>
            ))
          ) : (
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={onBar}>
              {data.map((d, i) => (
                <Cell key={i} fill={colorFor ? colorFor(d.label) : BRAND} cursor={links ? "pointer" : undefined} />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
      {/* THE LEGEND IS IN GREY, not in the grade colours, because the blocks
          are shades of whatever grade they belong to — a green 2 cm block and
          an amber 2 cm block are the same band. Colouring the key would have to
          pick one grade and imply the others were something else. */}
      {stacked && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
          {bands.map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: shade("#475569", BAND_SHADE[b]) }} />
              {b}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function gradeColor(label: string): string {
  const l = label.toUpperCase();
  if (l.startsWith("A")) return "#16a34a";
  if (l.startsWith("B")) return "#2563eb";
  if (l.startsWith("C")) return "#d97706";
  if (l.includes("BROKEN") || l.includes("REJECT")) return "#dc2626";
  return "#0f4c5c";
}
