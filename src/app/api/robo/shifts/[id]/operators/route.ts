import { NextResponse } from "next/server";
// ShiftOperatorAssignment model removed — operators are free-text on Shift
export async function GET() { return NextResponse.json([]); }
export async function POST() { return NextResponse.json({ error: "Not supported" }, { status: 410 }); }
export async function DELETE() { return NextResponse.json({ error: "Not supported" }, { status: 410 }); }
