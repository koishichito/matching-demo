import { NextResponse } from "next/server";
import { getStore, resetAll } from "@/server/store";

export const runtime = "nodejs";

export async function POST() {
  resetAll("manual");
  const store = getStore();
  return NextResponse.json({ ok: true, lastResetAt: store.lastResetAt });
}
