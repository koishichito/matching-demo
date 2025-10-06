import { NextResponse } from "next/server";
import { listMatchesForUser } from "@/server/store";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const matches = listMatchesForUser(userId.trim());
  return NextResponse.json({ items: matches });
}
