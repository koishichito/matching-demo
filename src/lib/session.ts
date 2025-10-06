export type SessionLocation = {
  lat: number;
  lng: number;
  label?: string;
  source: "geolocation" | "manual";
};

export type SessionSnapshot = {
  userId: string;
  nickname: string;
  tags: string[];
  vibe?: string;
  budget?: string;
  bio?: string;
  location?: SessionLocation;
};

const STORAGE_KEY = "joinus-demo-session";

export function loadSession(): SessionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed?.userId || !parsed.nickname) return null;
    return parsed;
  } catch (error) {
    console.error("Failed to load session", error);
    return null;
  }
}

export function persistSession(snapshot: SessionSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
