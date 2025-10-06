import { NextResponse } from "next/server";
import { acceptProposal } from "@/server/store";

export const runtime = "nodejs";

export const POST = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const accepterId = String(body.accepterId ?? body.userId ?? "").trim();
    if (!accepterId) {
      return NextResponse.json({ error: "accepterId is required" }, { status: 400 });
    }
    const match = acceptProposal(id, accepterId);
    return NextResponse.json(match, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to accept proposal";
    console.error("POST /api/proposals accept", error);
    const status = message === "failed to accept proposal" ? 500 : 400;
    return NextResponse.json({ error: message }, { status });
  }
};
