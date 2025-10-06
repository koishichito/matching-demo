import { NextResponse } from "next/server";
import { appendMessage, listMessages } from "@/server/store";

export const runtime = "nodejs";

type ParamsPromise = { params: Promise<{ id: string }> };

export const GET = async (_: Request, context: ParamsPromise) => {
  const { id } = await context.params;
  const messages = listMessages(id);
  return NextResponse.json({ items: messages });
};

export const POST = async (request: Request, context: ParamsPromise) => {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const from = String(body.from ?? "").trim();
    const text = String(body.text ?? "").trim();
    if (!from || !text) {
      return NextResponse.json({ error: "from and text are required" }, { status: 400 });
    }
    if (text.length > 500) {
      return NextResponse.json({ error: "text too long" }, { status: 400 });
    }
    const message = appendMessage({ matchId: id, from, text });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to append message";
    console.error("POST /api/matches/" + id + "/messages", error);
    const status = message === "failed to append message" ? 500 : 400;
    return NextResponse.json({ error: message }, { status });
  }
};
