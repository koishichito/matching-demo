import { NextResponse } from "next/server";
import { LOCATION_PRESETS } from "@/server/locations";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ items: LOCATION_PRESETS });
}
