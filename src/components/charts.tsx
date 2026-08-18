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

export function HBars({
  data,
  colorFor,
  links,
}: {
  data: { label: string; count: number }[];
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
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={onBar}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorFor ? colorFor(d.label) : BRAND} cursor={links ? "pointer" : undefined} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
