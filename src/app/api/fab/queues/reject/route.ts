import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { isFabProcessType } from "@/lib/fab/processSession";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import {
  allocationAfterReject,
  canRejectPiece,
  isRejectReason,
} from "@/lib/fab/rejectPiece";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => null);
  const pieceId = typeof body?.pieceId === "string" ? body.pieceId : "";
  const reason = body?.reason;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const processType = body?.processType;

  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });
  if (!isRejectReason(reason)) {
    return Response.json({ error: "Pick a reject reason." }, { status: 400 });
  }
  if (!isFabProcessType(processType)) {
    return Response.json({ error: "processType required" }, { status: 400 });
  }

  const gate = await requireProcessSession(processType);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;

  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        requirement_id: string | null;
        slab_id: string | null;
        packaged: boolean;
      }>>`
        SELECT
          p.id,
          p.status::text AS status,
          p.requirement_id,
          p.slab_id,
          EXISTS (
            SELECT 1 FROM fab_package_piece pp WHERE pp.piece_id = p.id
          ) AS packaged
        FROM fab_piece p
        WHERE p.id = ${pieceId}
        FOR UPDATE
      `;
      const piece = rows[0];
      if (!piece) throw new Err(404, "Piece not found.");

      const check = canRejectPiece(piece.status, piece.packaged);
      if (!check.ok) throw new Err(400, check.error);

      const claimed = await tx.$executeRaw`
        UPDATE fab_piece
        SET
          status = 'REJECTED'::"FabPieceStatus",
          rejected_at = NOW(),
          reject_reason = ${reason},
          reject_notes = ${notes || null},
          rejected_by_worker_id = ${sess.workerId}
        WHERE id = ${pieceId}
          AND status::text NOT IN ('REJECTED', 'PENDING', 'PACKAGED')
      `;
      if (claimed === 0) throw new Err(409, "Could not reject this piece. Refresh and try again.");

      if (piece.requirement_id && piece.slab_id) {
        const allocs = await tx.$queryRaw<Array<{ id: string; allocated_quantity: number }>>`
          SELECT id, allocated_quantity
          FROM fab_requirement_allocation
          WHERE requirement_id = ${piece.requirement_id}
            AND slab_id = ${piece.slab_id}
          FOR UPDATE
        `;
        const row = allocs[0];
        if (row) {
          const next = allocationAfterReject(Number(row.allocated_quantity));
          if (next.action === "delete") {
            await tx.$executeRaw`DELETE FROM fab_requirement_allocation WHERE id = ${row.id}`;
          } else if (next.action === "decrement") {
            await tx.$executeRaw`
              UPDATE fab_requirement_allocation
              SET allocated_quantity = ${next.next}
              WHERE id = ${row.id}
            `;
          }
        }
      }

      const opId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO fab_operation (
          id, piece_id, operator_id, machine_id, worker_id, shift,
          operation_type, status, start_time, end_time, created_at
        )
        VALUES (
          ${opId}, ${pieceId}, ${g.user.id as string}, ${sess.machineId},
          ${sess.workerId}, ${sess.shift},
          ${processType}::"FabOperationType", 'COMPLETED'::"FabOperationStatus",
          NOW(), NOW(), NOW()
        )
      `;
    });
  } catch (e) {
    if (e instanceof Err) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  return Response.json({ success: true });
}

class Err extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
