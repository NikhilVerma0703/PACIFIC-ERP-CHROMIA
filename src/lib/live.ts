// Live line snapshot: the most recent record at each station (which slab is on
// it), the running mixer cycle, and an active light (record in last 30 min).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";

const ACTIVE_MS = 30 * 60 * 1000;

export interface StationLive {
  key: string;
  label: string;
  slab: number | null;
  batch: string | null;
  operator: string | null;
  at: Date | null;
  active: boolean;
}

export interface MixerLive {
  batch: string | null;
  cycle: number | null;
  mixers: number[];
  operator: string | null;
  at: Date | null;
  active: boolean;
}

const isActive = (d: Date | null | undefined) => (d ? Date.now() - new Date(d).getTime() <= ACTIVE_MS : false);

export async function getLiveStatus(): Promise<{ stations: StationLive[]; mixer: MixerLive | null }> {
  try {
    // "Latest" = most recently ENTERED record (importedAt is always set, both for
    // app entries and for rows pulled in by the Airtable sync). Station timestamp
    // fields are often null on app-entered rows and Postgres puts NULLs first on
    // DESC, which made stale imports hijack the cards.
    const [press, distributor, kreos, oven, jot, pe, pq, mixer] = await Promise.all([
      prisma.press.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, operator: true, createdTime: true, importedAt: true } }),
      prisma.distributor.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, operator: true, createdTime: true, importedAt: true } }),
      prisma.kreos.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, operator: true, createdTime: true, importedAt: true } }),
      prisma.oven.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, operator: true, date: true, importedAt: true } }),
      prisma.jot.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, operator: true, createdTime: true, importedAt: true } }),
      prisma.polishEntry.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, calliberator: true, created: true, importedAt: true } }),
      prisma.polishQc.findFirst({ orderBy: { importedAt: "desc" }, select: { slabNumber: true, batchKey: true, inspector: true, createdTime: true, importedAt: true } }),
      prisma.mixerCycle.findFirst({ orderBy: { importedAt: "desc" }, select: { cycle: true, batchKey: true, operator: true, mixer1: true, mixer2: true, mixer3: true, mixer4: true, mixerStartTime: true, mixerEndTime: true, importedAt: true } }),
    ]);

    const mk = (key: string, label: string, slab: any, batch: any, operator: any, at: Date | null): StationLive => ({
      key, label,
      slab: typeof slab === "number" ? slab : null,
      batch: batch ?? null,
      operator: operator ?? null,
      at: at ?? null,
      active: isActive(at),
    });

    const stations: StationLive[] = [
      mk("press", "Press", press?.slabNumber, press?.batchKey, press?.operator, press?.createdTime ?? press?.importedAt ?? null),
      mk("distributor", "Distributor", distributor?.slabNumber, distributor?.batchKey, distributor?.operator, distributor?.createdTime ?? distributor?.importedAt ?? null),
      mk("kreos", "Kreos", kreos?.slabNumber, kreos?.batchKey, kreos?.operator, kreos?.createdTime ?? kreos?.importedAt ?? null),
      mk("oven", "Oven", oven?.slabNumber, oven?.batchKey, oven?.operator, oven?.date ?? oven?.importedAt ?? null),
      mk("jot", "Jot", jot?.slabNumber, jot?.batchKey, jot?.operator, jot?.createdTime ?? jot?.importedAt ?? null),
      mk("polishEntry", "Polish Entry", pe?.slabNumber, pe?.batchKey, pe?.calliberator, pe?.created ?? pe?.importedAt ?? null),
      mk("polishQc", "Polish QC", pq?.slabNumber, pq?.batchKey, pq?.inspector, pq?.createdTime ?? pq?.importedAt ?? null),
    ];

    const mixerLive: MixerLive | null = mixer ? {
      batch: mixer.batchKey ?? null,
      cycle: typeof mixer.cycle === "number" ? mixer.cycle : null,
      mixers: [mixer.mixer1 ? 1 : 0, mixer.mixer2 ? 2 : 0, mixer.mixer3 ? 3 : 0, mixer.mixer4 ? 4 : 0].filter((n) => n > 0),
      operator: mixer.operator ?? null,
      at: mixer.mixerStartTime ?? mixer.importedAt ?? null,
      active: isActive(mixer.mixerStartTime ?? mixer.importedAt), // recently entered/run = green
    } : null;

    return { stations, mixer: mixerLive };
  } catch {
    return { stations: [], mixer: null };
  }
}
