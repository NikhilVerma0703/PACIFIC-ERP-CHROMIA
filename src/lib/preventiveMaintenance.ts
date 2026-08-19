// The preventive-maintenance register: planned work the maintenance team did,
// logged after the fact — this day, this hour, this many minutes, at this
// station, doing this. It is a diary, not a queue: nothing here is a fault,
// nothing awaits an answer, and nothing implies the line stopped. That is why
// it is its own table rather than more rows in maintenance_ticket — a ticket
// models a conversation (status, response, closure) that a register entry
// never has. The client-safe vocabulary and validation live in
// preventiveMaintenanceShared.ts; this half is the database.

import { prisma } from "@/lib/prisma";
import type { NewPmEntry, PmEntry } from "@/lib/preventiveMaintenanceShared";

export async function addPmEntry(e: NewPmEntry, actor: string | null, enteredById: string | null): Promise<void> {
  await prisma.preventiveMaintenance.create({
    data: {
      // @db.Date column: midnight UTC of the named day stores as exactly that day
      date: new Date(`${e.date}T00:00:00.000Z`),
      hour: e.hour,
      minutes: Math.round(Number(e.minutes)),
      station: e.station.trim(),
      description: e.description.trim(),
      actor, enteredById,
    },
  });
}

/** Entries for the page's window (from/to are "YYYY-MM-DD", both inclusive),
 *  newest work first. Same window the incident list uses, so the register and
 *  the queue always describe the same span of days. */
export async function listPmEntries(from: string, to: string): Promise<PmEntry[]> {
  const rows = await prisma.preventiveMaintenance.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
    orderBy: [{ date: "desc" }, { hour: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    hour: r.hour,
    minutes: r.minutes,
    station: r.station,
    description: r.description,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
  }));
}
