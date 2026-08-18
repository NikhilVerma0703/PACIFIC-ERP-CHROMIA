import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import type { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { slabStatusView } from '@/lib/chromia/slab-status-label';

import { Badge, type Tone } from './index';

const GRADE_TONE: Record<SlabGrade, Tone> = {
  A: 'done',
  B: 'hold',
  C: 'waste',
};

/** One colour per outcome — no two share a tone, so the list stays scannable. */
const DISPOSITION_TONE: Record<Disposition, Tone> = {
  DISPATCH: 'done', // green
  STOCK: 'active', // blue
  SAMPLE_CUTTING: 'hold', // amber
  RECALIBRATION: 'recalibration', // violet
  WASTE: 'waste', // red
};

/**
 * The slab's status, as a person needs to read it.
 *
 * Pass the outcome alongside the status wherever it is to hand: a slab QC has
 * condemned reads "Pending Recalibration" rather than "Graded", which is true
 * of every slab that has ever been through QC and therefore tells nobody
 * anything. Without an outcome the badge falls back to the plain status name.
 */
export function StatusBadge({
  status,
  disposition,
}: {
  status: SlabStatus;
  disposition?: Disposition | null;
}) {
  const view = slabStatusView(status, disposition);
  return <Badge tone={view.tone}>{view.label}</Badge>;
}

export function GradeBadge({ grade }: { grade: SlabGrade | null }) {
  if (!grade) return <span className="text-muted">—</span>;
  return (
    <Badge tone={GRADE_TONE[grade]} dot={false}>
      Grade {grade}
    </Badge>
  );
}

export function DispositionBadge({ disposition }: { disposition: Disposition | null }) {
  if (!disposition) return <span className="text-muted">—</span>;
  return (
    <Badge tone={DISPOSITION_TONE[disposition]} dot={false}>
      {DISPOSITION_LABELS[disposition]}
    </Badge>
  );
}
