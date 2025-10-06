import { NextResponse } from "next/server";
import { upsertUser } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const nickname = (body.nickname ?? "").trim();
    const tags = normalizeTags(body.tags);
    if (!nickname) {
      return NextResponse.json({ error: "nickname is required" }, { status: 400 });
    }
    const profile = upsertUser({
      id: body.id,
      nickname,
      tags,
      bio: body.bio,
      vibe: body.vibe,
      budget: body.budget,
    });
    return NextResponse.json(profile, { status: body.id ? 200 : 201 });
  } catch (error) {
    console.error("POST /api/users", error);
    return NextResponse.json({ error: "failed to upsert user" }, { status: 500 });
  }
}

function normalizeTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((value) => String(value)).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}
