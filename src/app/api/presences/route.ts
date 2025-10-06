import { NextResponse } from "next/server";
import { findPreset } from "@/server/locations";
import { setPresence } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = String(body.userId ?? "").trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const parsed = resolveLocation(body);
    if (!parsed) {
      return NextResponse.json({ error: "location is required" }, { status: 400 });
    }

    const presence = setPresence({
      userId,
      lat: parsed.lat,
      lng: parsed.lng,
      locationLabel: parsed.label,
    });
    return NextResponse.json(presence, { status: 201 });
  } catch (error) {
    console.error("POST /api/presences", error);
    return NextResponse.json({ error: "failed to set presence" }, { status: 500 });
  }
}

type LocationInput = {
  lat: number;
  lng: number;
  label?: string;
};

function resolveLocation(body: unknown): LocationInput | null {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const lat = toNumber(record.lat);
    const lng = toNumber(record.lng);
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng, label: typeof record.locationLabel === "string" ? record.locationLabel : undefined };
    }
    const keyCandidate =
      typeof record.presetKey === "string"
        ? record.presetKey
        : typeof record.locationKey === "string"
        ? record.locationKey
        : typeof record.locationTerm === "string"
        ? record.locationTerm
        : undefined;
    const key = keyCandidate?.trim();
    if (key) {
      const preset = findPreset(key);
      if (preset) {
        return { lat: preset.lat, lng: preset.lng, label: preset.label };
      }
    }
  }
  return null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

