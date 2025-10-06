import { NextResponse } from "next/server";
import { createProposal, listProposalsForUser } from "@/server/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const data = listProposalsForUser(userId.trim());
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const from = String(body.from ?? "").trim();
    const to = String(body.to ?? "").trim();
    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }
    const proposal = createProposal(from, to);
    return NextResponse.json(proposal, { status: 201 });
  } catch (error) {
    console.error("POST /api/proposals", error);
    return NextResponse.json({ error: "failed to create proposal" }, { status: 500 });
  }
}
