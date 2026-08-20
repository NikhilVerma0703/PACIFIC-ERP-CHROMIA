// Per-process operator sessions. One shared login (operator@…); each sidebar
// station has its own session cookie, name, and shift until End Session.
//
// This file is PURE so node --test can import the cookie/type helpers. The
// Prisma/cookie lookups live in processSessionServer.ts.

export const FAB_PROCESS_TYPES = [
  "CUTTING",
  "POLISHING",
  "SINK_CUTTING",
  "FABRICATION",
  "PACKAGING",
] as const;

export type FabProcessType = (typeof FAB_PROCESS_TYPES)[number];

export const FAB_PROCESS_LABEL: Record<FabProcessType, string> = {
  CUTTING: "Cutting",
  POLISHING: "Polishing",
  SINK_CUTTING: "Sink Cutting",
  FABRICATION: "Fabrication",
  PACKAGING: "Packaging",
};

export const FAB_SHIFTS = [
  { id: "Morning", label: "Morning", time: "6:00 – 14:00" },
  { id: "Afternoon", label: "Afternoon", time: "14:00 – 22:00" },
  { id: "Night", label: "Night", time: "22:00 – 6:00" },
] as const;

export function isFabProcessType(value: unknown): value is FabProcessType {
  return typeof value === "string" && (FAB_PROCESS_TYPES as readonly string[]).includes(value);
}

export function processSessionCookie(type: FabProcessType): string {
  return `fab_ps_${type}`;
}

export const PROCESS_SESSION_COOKIE_MAX_AGE = 60 * 60 * 12;

export interface ProcessSession {
  id: string;
  userId: string;
  machineId: string;
  machineName: string;
  workerId: string;
  workerName: string;
  shift: string;
  processType: FabProcessType;
}
