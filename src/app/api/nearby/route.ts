import { NextResponse } from "next/server";
import { listNearby } from "@/server/store";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  const lat = toNumber(url.searchParams.get("lat"));
  const lng = toNumber(url.searchParams.get("lng"));
  const radiusKm = toNumber(url.searchParams.get("radiusKm")) ?? 3;
  const selfUserId = url.searchParams.get("selfUserId") ?? undefined;

  if (lat === undefined || lng === undefined) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const listings = listNearby({
    userLat: lat,
    userLng: lng,
    radiusKm,
    selfUserId,
  });

  return NextResponse.json({ items: listings });
}

function toNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}
