import { NextResponse } from "next/server";
import { getUser } from "@/server/store";

export const runtime = "nodejs";

export const GET = async (_: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const user = getUser(id);
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(user);
};
