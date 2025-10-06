import type {
  Match,
  Message,
  NearbyListing,
  Presence,
  Proposal,
  UserProfile,
} from "@/server/types";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

type ApiError = { error: string };

type UpsertUserPayload = {
  id?: string;
  nickname: string;
  tags: string[];
  bio?: string;
  vibe?: string;
  budget?: string;
};

type PresencePayload = {
  userId: string;
  lat?: number;
  lng?: number;
  locationLabel?: string;
  presetKey?: string;
  locationKey?: string;
  locationTerm?: string;
};

export async function fetchUser(userId: string): Promise<UserProfile> {
  const response = await fetch("/api/users/" + encodeURIComponent(userId));
  return parseJson<UserProfile>(response);
}

export async function upsertUserProfile(payload: UpsertUserPayload): Promise<UserProfile> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJson<UserProfile>(response);
}

export async function postPresence(payload: PresencePayload): Promise<Presence> {
  const response = await fetch("/api/presences", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJson<Presence>(response);
}

export async function deletePresence(userId: string): Promise<void> {
  await fetch("/api/presences/" + encodeURIComponent(userId), {
    method: "DELETE",
  });
}

export async function fetchNearby(input: {
  lat: number;
  lng: number;
  radiusKm: number;
  selfUserId?: string;
}): Promise<NearbyListing[]> {
  const params = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
    radiusKm: String(input.radiusKm),
  });
  if (input.selfUserId) {
    params.set("selfUserId", input.selfUserId);
  }
  const response = await fetch("/api/nearby?" + params.toString());
  const data = await parseJson<{ items: NearbyListing[] }>(response);
  return data.items;
}

export async function postProposal(from: string, to: string): Promise<Proposal> {
  const response = await fetch("/api/proposals", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ from, to }),
  });
  return parseJson<Proposal>(response);
}

export async function acceptProposalRequest(id: string, accepterId: string): Promise<Match> {
  const response = await fetch("/api/proposals/" + encodeURIComponent(id) + "/accept", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ accepterId }),
  });
  return parseJson<Match>(response);
}

export async function fetchMessages(matchId: string): Promise<Message[]> {
  const response = await fetch("/api/matches/" + encodeURIComponent(matchId) + "/messages");
  const data = await parseJson<{ items: Message[] }>(response);
  return data.items;
}

export async function postMessage(input: { matchId: string; from: string; text: string }): Promise<Message> {
  const response = await fetch("/api/matches/" + encodeURIComponent(input.matchId) + "/messages", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ from: input.from, text: input.text }),
  });
  return parseJson<Message>(response);
}

export async function postReset(): Promise<{ ok: boolean; lastResetAt?: string }> {
  const response = await fetch("/api/reset", {
    method: "POST",
  });
  return parseJson<{ ok: boolean; lastResetAt?: string }>(response);
}

export async function postReport(payload: {
  reporterId: string;
  reportedUserId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: ApiError | null = await response.json().catch(() => null);
    const message = data?.error ?? "Failed to submit report";
    throw new Error(message);
  }
}

export type LocationPreset = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  tags?: string[];
};

export async function fetchLocationPresets(): Promise<LocationPreset[]> {
  const response = await fetch("/api/location-presets");
  const data = await parseJson<{ items: LocationPreset[] }>(response);
  return data.items;
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => {
    throw new Error("Invalid server response");
  });
  if (!response.ok) {
    const message = typeof (data as ApiError)?.error === "string" ? (data as ApiError).error : "Request failed";
    throw new Error(message);
  }
  return data as T;
}
