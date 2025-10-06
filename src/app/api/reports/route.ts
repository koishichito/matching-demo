import { NextResponse } from "next/server";
import { addReport } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reporterId = String(body.reporterId ?? "").trim();
    const reportedUserId = String(body.reportedUserId ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const details = body.details ? String(body.details).slice(0, 1000) : undefined;
    if (!reporterId || !reportedUserId || !reason) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }
    const report = addReport({ reporterId, reportedUserId, reason, details });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("POST /api/reports", error);
    return NextResponse.json({ error: "failed to submit report" }, { status: 500 });
  }
}
