import { NextResponse } from "next/server";
import { removePresence } from "@/server/store";

export const runtime = "nodejs";

export const DELETE = async (_: Request, context: { params: Promise<{ userId: string }> }) => {
  const { userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const removed = removePresence(userId);
  if (!removed) {
    return NextResponse.json({ ok: true, removed: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true, removed: true });
};
