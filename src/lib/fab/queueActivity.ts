// Recent-activity ranking for station queues. Pure: the GET routes attach
// these fields, the screens highlight from them, and node --test covers the
// sort so "newest work at the top" cannot silently become createdAt asc again.

export const STAGE_CHIP: Record<string, string> = {
  CUTTING: "Cut",
  POLISHING: "Polished",
  SINK_CUTTING: "Sink done",
  FABRICATION: "Fab done",
  PACKAGING: "Packed",
};

/** Two hours: still "just arrived from the last station" on a one-laptop line. */
export const RECENT_ACTIVITY_MS = 2 * 60 * 60 * 1000;

export interface OpStamp {
  operationType: string;
  isCompleted: boolean;
  completedAt: Date | string | null;
}

export interface QueueActivity {
  lastActivityAt: string | null;
  otherDone: string[];
  recent: boolean;
}

export function queueActivity(ops: OpStamp[], currentType: string, now = Date.now()): QueueActivity {
  let lastMs = 0;
  const otherDone: string[] = [];
  for (const op of ops) {
    if (!op.isCompleted) continue;
    const t = op.completedAt ? new Date(op.completedAt).getTime() : 0;
    if (Number.isFinite(t) && t > lastMs) lastMs = t;
    if (op.operationType !== currentType && !otherDone.includes(op.operationType)) {
      otherDone.push(op.operationType);
    }
  }
  const order = ["CUTTING", "POLISHING", "SINK_CUTTING", "FABRICATION", "PACKAGING"];
  otherDone.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    lastActivityAt: lastMs ? new Date(lastMs).toISOString() : null,
    otherDone,
    recent: lastMs > 0 && now - lastMs <= RECENT_ACTIVITY_MS,
  };
}

export function sortByRecentActivity<T>(
  items: T[],
  getLast: (item: T) => string | Date | null | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const ta = stampMs(getLast(a));
    const tb = stampMs(getLast(b));
    return tb - ta;
  });
}

export function attachQueueActivity<T extends { pieceOperations?: OpStamp[] }>(
  pieces: T[],
  currentType: string,
) {
  const mapped = pieces.map((p) => {
    const { pieceOperations, ...rest } = p;
    return { ...rest, ...queueActivity(pieceOperations ?? [], currentType) };
  });
  return sortByRecentActivity(mapped, (p) => p.lastActivityAt);
}

function stampMs(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const n = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}
