/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// GET /api/sales/orders/[id]/port-arrival
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  const pa = await db.salesPortArrival.findUnique({ where: { orderId: id } });
  return NextResponse.json(pa ?? null);
}

// POST /api/sales/orders/[id]/port-arrival — create (only if not exists)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  const existing = await db.salesPortArrival.findUnique({ where: { orderId: id } });
  if (existing) return NextResponse.json({ error: "Port arrival record already exists — use PATCH to update" }, { status: 409 });

  const body = await req.json() as {
    arrivalDate?: string;
    freeDays?: number;
    freeDaysExpiry?: string;
    cadCleared?: boolean;
    deliveryStatus?: string;
    overrideNote?: string;
  };

  const pa = await db.salesPortArrival.create({
    data: {
      orderId:       id,
      arrivalDate:   body.arrivalDate   ? new Date(body.arrivalDate)   : null,
      freeDays:      body.freeDays      ?? null,
      freeDaysExpiry:body.freeDaysExpiry ? new Date(body.freeDaysExpiry) : null,
      cadCleared:    body.cadCleared    ?? false,
      deliveryStatus:body.deliveryStatus ?? "PENDING",
      overrideById:  body.overrideNote  ? userId : null,
      overrideAt:    body.overrideNote  ? new Date() : null,
      overrideNote:  body.overrideNote  ?? null,
    },
  });

  await db.salesOrderLog.create({
    data: {
      orderId: id, userId,
      action: "PORT_ARRIVAL_CREATED",
      note: `Arrival recorded${body.arrivalDate ? " — " + new Date(body.arrivalDate).toLocaleDateString("en-GB") : ""}`,
    },
  }).catch(() => {});

  return NextResponse.json(pa, { status: 201 });
}

// PATCH /api/sales/orders/[id]/port-arrival — update existing
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  const body = await req.json() as {
    arrivalDate?: string | null;
    freeDays?: number | null;
    freeDaysExpiry?: string | null;
    cadCleared?: boolean;
    deliveryStatus?: string;
    overrideNote?: string | null;
  };

  const data: Record<string, any> = {};
  if (body.arrivalDate    !== undefined) data.arrivalDate    = body.arrivalDate    ? new Date(body.arrivalDate)    : null;
  if (body.freeDays       !== undefined) data.freeDays       = body.freeDays       ?? null;
  if (body.freeDaysExpiry !== undefined) data.freeDaysExpiry = body.freeDaysExpiry ? new Date(body.freeDaysExpiry) : null;
  if (body.cadCleared     !== undefined) data.cadCleared     = body.cadCleared;
  if (body.deliveryStatus !== undefined) data.deliveryStatus = body.deliveryStatus;
  if (body.overrideNote   !== undefined) {
    data.overrideNote  = body.overrideNote ?? null;
    data.overrideById  = body.overrideNote ? userId : null;
    data.overrideAt    = body.overrideNote ? new Date() : null;
  }

  const pa = await db.salesPortArrival.upsert({
    where: { orderId: id },
    create: { orderId: id, ...data },
    update: data,
  });

  const changes = Object.keys(data).join(", ");
  await db.salesOrderLog.create({
    data: {
      orderId: id, userId,
      action: "PORT_ARRIVAL_UPDATED",
      note: `Updated: ${changes}`,
    },
  }).catch(() => {});

  return NextResponse.json(pa);
}
