import { NextResponse } from "next/server";
import { roboGate } from "@/lib/rbac";
// ShiftOperatorAssignment model removed — operators are free-text on Shift
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json([]);
}
export async function POST() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json({ error: "Not supported" }, { status: 410 });
}
export async function DELETE() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json({ error: "Not supported" }, { status: 410 });
}
