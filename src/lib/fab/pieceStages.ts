// Per-piece stage flags for the CEO slab list. PURE so node --test can import it.

export type StageFlag = "na" | "pending" | "done" | "rejected";

export interface PieceStageInput {
  status: string;
  polishRequired: boolean;
  polishingCompleted: boolean;
  hasSink: boolean;
  sinkCompleted: boolean;
  fabricationRequired: boolean;
  fabricationCompleted: boolean;
}

export interface PieceStages {
  cutting: StageFlag;
  polishing: StageFlag;
  sink: StageFlag;
  fabrication: StageFlag;
  packaging: StageFlag;
}

export function pieceStages(p: PieceStageInput): PieceStages {
  if (p.status === "REJECTED") {
    return {
      cutting: "done",
      polishing: p.polishRequired ? "rejected" : "na",
      sink: p.hasSink ? "rejected" : "na",
      fabrication: p.fabricationRequired ? "rejected" : "na",
      packaging: "rejected",
    };
  }

  const cutDone = p.status !== "PENDING";
  return {
    cutting: cutDone ? "done" : "pending",
    polishing: !p.polishRequired ? "na" : p.polishingCompleted ? "done" : cutDone ? "pending" : "pending",
    sink: !p.hasSink ? "na" : p.sinkCompleted ? "done" : "pending",
    fabrication: !p.fabricationRequired ? "na" : p.fabricationCompleted ? "done" : "pending",
    packaging: p.status === "PACKAGED" ? "done" : "pending",
  };
}

export function summarizeStages(pieces: PieceStages[]): {
  total: number;
  packaged: number;
  rejected: number;
  waitingCut: number;
  inProcess: number;
} {
  let packaged = 0, rejected = 0, waitingCut = 0, inProcess = 0;
  for (const s of pieces) {
    if (s.packaging === "rejected" || s.cutting === "rejected") { rejected++; continue; }
    if (s.packaging === "done") { packaged++; continue; }
    if (s.cutting === "pending") { waitingCut++; continue; }
    inProcess++;
  }
  return { total: pieces.length, packaged, rejected, waitingCut, inProcess };
}
