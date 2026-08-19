// Parse + humanise MixerCycle field names (m1G1Sn -> "Mixer 1 · Grit 1 · Silo number").
// Pure module — safe in client bundles.
export interface MixerFieldInfo {
  mixer: number;
  grit: number | null;
  kind: "silo" | "weight" | "filler" | "resinWeight" | "resinDtn" | "other";
}

export function classifyMixer(prismaField: string): MixerFieldInfo | null {
  const m = prismaField.match(/^m([1-4])([A-Z].*)$/);
  if (!m) return null;
  const mixer = Number(m[1]);
  const rest = m[2];
  let g;
  if ((g = rest.match(/^G([1-8])Sn$/))) return { mixer, grit: Number(g[1]), kind: "silo" };
  if ((g = rest.match(/^W([1-8])$/))) return { mixer, grit: Number(g[1]), kind: "weight" };
  if (rest === "FW") return { mixer, grit: null, kind: "filler" };
  if (rest === "RW") return { mixer, grit: null, kind: "resinWeight" };
  if (rest === "RDtn") return { mixer, grit: null, kind: "resinDtn" };
  return { mixer, grit: null, kind: "other" };
}

export function mixerFullLabel(prismaField: string, fallback: string): string {
  const c = classifyMixer(prismaField);
  if (!c) return fallback;
  const M = `Mixer ${c.mixer}`;
  switch (c.kind) {
    case "silo": return `${M} · Grit ${c.grit} · Silo number`;
    case "weight": return `${M} · Grit ${c.grit} · Weight (kg)`;
    case "filler": return `${M} · Filler weight (kg)`;
    case "resinWeight": return `${M} · Resin weight (kg)`;
    case "resinDtn": return `${M} · Resin DTN`;
    default: return fallback;
  }
}
