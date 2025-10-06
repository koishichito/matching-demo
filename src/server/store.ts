import { randomUUID as nodeRandomUUID } from "node:crypto";
import { LOCATION_PRESETS, distanceInKm, toGrid } from "./locations";
import type {
  Match,
  Message,
  NearbyListing,
  Presence,
  Proposal,
  Report,
  UserProfile,
} from "./types";
import { broadcast } from "./realtime";

export type InMemoryStore = {
  users: Map<string, UserProfile>;
  presences: Map<string, Presence>;
  proposals: Map<string, Proposal>;
  matches: Map<string, Match>;
  messages: Map<string, Message[]>;
  reports: Report[];
  lastResetAt?: string;
};

type GlobalWithStore = typeof globalThis & {
  __demoStore?: InMemoryStore;
  __demoResetTimer?: NodeJS.Timeout;
};

const globalRef = globalThis as GlobalWithStore;

if (!globalRef.__demoStore) {
  globalRef.__demoStore = initializeStore();
  scheduleDailyReset(globalRef.__demoStore);
}

export function getStore(): InMemoryStore {
  return globalRef.__demoStore!;
}

function generateId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return nodeRandomUUID();
}

export function upsertUser(input: {
  id?: string;
  nickname: string;
  tags: string[];
  bio?: string;
  vibe?: string;
  budget?: string;
  ageVerified?: boolean;
}): UserProfile {
  const store = getStore();
  const nowIso = new Date().toISOString();
  const id = input.id?.trim() || generateId();
  const existing = store.users.get(id);

  const profile: UserProfile = {
    id,
    nickname: input.nickname,
    ageVerified: input.ageVerified ?? true,
    tags: input.tags,
    bio: input.bio,
    vibe: input.vibe,
    budget: input.budget,
    createdAt: existing?.createdAt ?? nowIso,
    lastActiveAt: nowIso,
  };

  store.users.set(id, profile);
  return profile;
}

export function getUser(id: string): UserProfile | undefined {
  return getStore().users.get(id);
}

export function listUsers(): UserProfile[] {
  return Array.from(getStore().users.values());
}

export function setPresence(input: {
  userId: string;
  lat: number;
  lng: number;
  locationLabel?: string;
}): Presence {
  const store = getStore();
  const user = store.users.get(input.userId);
  if (!user) {
    throw new Error("User not found");
  }

  const { gridLat, gridLng } = toGrid(input.lat, input.lng);
  const now = new Date();
  const presence: Presence = {
    userId: input.userId,
    gridLat,
    gridLng,
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    locationLabel: input.locationLabel,
    since: now.toISOString(),
    expiresAt: getNextResetAt(now).toISOString(),
  };

  store.presences.set(input.userId, presence);
  broadcast({ type: "presence:update", payload: presence });
  return presence;
}

export function removePresence(userId: string): boolean {
  const store = getStore();
  const removed = store.presences.delete(userId);
  if (removed) {
    broadcast({ type: "presence:remove", payload: { userId } });
  }
  return removed;
}

export function listNearby(input: {
  userLat: number;
  userLng: number;
  radiusKm: number;
  selfUserId?: string;
}): NearbyListing[] {
  const store = getStore();
  const results: NearbyListing[] = [];
  for (const presence of store.presences.values()) {
    const user = store.users.get(presence.userId);
    if (!user) continue;
    const distanceKm = distanceInKm(input.userLat, input.userLng, presence.lat, presence.lng);
    if (distanceKm > input.radiusKm) continue;
    const isSelf = input.selfUserId === presence.userId;
    const affinity = computeAffinityScore(user, distanceKm) + (isSelf ? 100 : 0);
    results.push({ user, presence, distanceKm, affinityScore: affinity });
  }
  results.sort((a, b) => a.distanceKm - b.distanceKm || b.affinityScore - a.affinityScore);
  return results;
}

export function listProposalsForUser(userId: string): { incoming: Proposal[]; outgoing: Proposal[] } {
  const store = getStore();
  const incoming: Proposal[] = [];
  const outgoing: Proposal[] = [];
  for (const proposal of store.proposals.values()) {
    if (proposal.to === userId) {
      incoming.push(proposal);
    }
    if (proposal.from === userId) {
      outgoing.push(proposal);
    }
  }
  incoming.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  outgoing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { incoming, outgoing };
}

export function listMatchesForUser(userId: string): Match[] {
  const store = getStore();
  const results: Match[] = [];
  for (const match of store.matches.values()) {
    if (match.userA === userId || match.userB === userId) {
      results.push(match);
    }
  }
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}
export function createProposal(from: string, to: string): Proposal {
  const store = getStore();
  if (from === to) {
    throw new Error("Cannot propose to self");
  }
  const match = findActiveMatch(store, from, to);
  if (match) {
    return {
      id: generateId(),
      from,
      to,
      createdAt: new Date().toISOString(),
      status: "accepted",
      respondedAt: match.createdAt,
      matchId: match.id,
    };
  }

  const proposal: Proposal = {
    id: generateId(),
    from,
    to,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  store.proposals.set(proposal.id, proposal);
  broadcast({ type: "proposal:created", payload: proposal });
  return proposal;
}

export function acceptProposal(proposalId: string, accepterId: string): Match {
  const store = getStore();
  const proposal = store.proposals.get(proposalId);
  if (!proposal) {
    throw new Error("Proposal not found");
  }
  if (proposal.to !== accepterId) {
    throw new Error("Only the recipient can accept");
  }
  if (proposal.status === "accepted" && proposal.matchId) {
    const existingMatch = store.matches.get(proposal.matchId);
    if (existingMatch) return existingMatch;
  }

  const match = createMatchInternal(store, proposal.from, proposal.to);
  proposal.status = "accepted";
  proposal.matchId = match.id;
  proposal.respondedAt = new Date().toISOString();
  store.proposals.set(proposal.id, proposal);
  broadcast({ type: "proposal:accepted", payload: { proposalId, match } });
  return match;
}

export function createMatch(userA: string, userB: string): Match {
  const store = getStore();
  return createMatchInternal(store, userA, userB);
}

export function closeMatch(matchId: string): void {
  const store = getStore();
  const match = store.matches.get(matchId);
  if (!match || match.closedAt) return;
  match.closedAt = new Date().toISOString();
  store.matches.set(matchId, match);
  broadcast({ type: "match:closed", payload: { matchId } });
}

export function listMessages(matchId: string): Message[] {
  return getStore().messages.get(matchId) ?? [];
}

export function appendMessage(input: { matchId: string; from: string; text: string }): Message {
  const store = getStore();
  const match = store.matches.get(input.matchId);
  if (!match || match.closedAt) {
    throw new Error("Match is not active");
  }
  const message: Message = {
    id: generateId(),
    matchId: input.matchId,
    from: input.from,
    text: input.text,
    sentAt: new Date().toISOString(),
  };
  const thread = store.messages.get(input.matchId) ?? [];
  thread.push(message);
  store.messages.set(input.matchId, thread);
  broadcast({ type: "message:new", payload: message });
  return message;
}

export function addReport(report: Omit<Report, "id" | "createdAt">): Report {
  const store = getStore();
  const stored: Report = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...report,
  };
  store.reports.push(stored);
  return stored;
}

export function resetAll(reason: "auto" | "manual" = "manual"): void {
  void reason;
  const store = getStore();
  const nowIso = new Date().toISOString();

  for (const presence of store.presences.values()) {
    broadcast({ type: "presence:remove", payload: { userId: presence.userId } });
  }
  store.presences.clear();

  for (const match of store.matches.values()) {
    if (!match.closedAt) {
      match.closedAt = nowIso;
      store.matches.set(match.id, match);
      broadcast({ type: "match:closed", payload: { matchId: match.id } });
    }
  }

  store.proposals.clear();
  store.lastResetAt = nowIso;
  broadcast({ type: "reset:run", payload: { at: nowIso } });
}

export function getNextResetAt(from = new Date()): Date {
  const dateInTokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(from);
  const [year, month, day] = dateInTokyo.split("-");
  const target = new Date(year + '-' + month + '-' + day + 'T05:00:00+09:00');
  if (from.getTime() < target.getTime()) {
    return target;
  }
  return new Date(target.getTime() + 24 * 60 * 60 * 1000);
}

function computeAffinityScore(user: UserProfile, distanceKm: number): number {
  const tagBonus = Math.min(user.tags.length, 5) * 2;
  const distanceScore = Math.max(0, 20 - distanceKm * 5);
  return tagBonus + distanceScore;
}

function findActiveMatch(store: InMemoryStore, userA: string, userB: string): Match | undefined {
  for (const match of store.matches.values()) {
    const samePair =
      (match.userA === userA && match.userB === userB) ||
      (match.userA === userB && match.userB === userA);
    if (!match.closedAt && samePair) {
      return match;
    }
  }
  return undefined;
}

function initializeStore(): InMemoryStore {
  const store: InMemoryStore = {
    users: new Map(),
    presences: new Map(),
    proposals: new Map(),
    matches: new Map(),
    messages: new Map(),
    reports: [],
  };

  seedDemoUsers(store);
  return store;
}

function seedDemoUsers(store: InMemoryStore) {
  const now = new Date();
  const nowIso = now.toISOString();
  const resetIso = getNextResetAt(now).toISOString();

  const seeds: Array<{
    id: string;
    nickname: string;
    tags: string[];
    bio?: string;
    vibe?: string;
    budget?: string;
    presetKey: string;
  }> = [
    {
      id: "demo-aya",
      nickname: "Aya",
      tags: ["静かに飲みたい", "新しい出会い歓迎"],
      bio: "恵比寿のワインバーを開拓中。おすすめを交換しましょう。",
      vibe: "ゆったり",
      budget: "5000〜7000円",
      presetKey: "ebisu",
    },
    {
      id: "demo-ryo",
      nickname: "Ryo",
      tags: ["サクッと一杯", "はしご酒"],
      bio: "渋谷でライブ帰り。もう一杯どうですか。",
      vibe: "にぎやか",
      budget: "3000円未満",
      presetKey: "shibuya",
    },
    {
      id: "demo-sara",
      nickname: "Sara",
      tags: ["英語でOK", "旅の話がしたい"],
      bio: "六本木ヒルズ周辺にいます。海外のおしゃべりができる人歓迎。",
      vibe: "静かなバー",
      budget: "5000〜7000円",
      presetKey: "roppongi",
    },
    {
      id: "demo-daichi",
      nickname: "Daichi",
      tags: ["仕事の話歓迎", "静かに飲みたい"],
      bio: "銀座で打ち合わせ終わり。軽く振り返りませんか。",
      vibe: "ゆったり",
      budget: "7000円以上",
      presetKey: "ginza",
    },
    {
      id: "demo-hina",
      nickname: "Hina",
      tags: ["旅の話がしたい", "じっくり会話"],
      bio: "京都を旅行中。地元の穴場を教えてください。",
      vibe: "カジュアル",
      budget: "3000〜5000円",
      presetKey: "kyoto",
    },
  ];

  for (const seed of seeds) {
    const preset = LOCATION_PRESETS.find((item) => item.key === seed.presetKey);
    if (!preset) continue;

    const user: UserProfile = {
      id: seed.id,
      nickname: seed.nickname,
      ageVerified: true,
      tags: seed.tags,
      bio: seed.bio,
      vibe: seed.vibe,
      budget: seed.budget,
      createdAt: nowIso,
      lastActiveAt: nowIso,
    };
    store.users.set(user.id, user);

    const { gridLat, gridLng } = toGrid(preset.lat, preset.lng);
    const presence: Presence = {
      userId: user.id,
      gridLat,
      gridLng,
      lat: preset.lat,
      lng: preset.lng,
      locationLabel: preset.label,
      since: nowIso,
      expiresAt: resetIso,
    };
    store.presences.set(user.id, presence);
  }
}

function scheduleDailyReset(store: InMemoryStore) {
  if (globalRef.__demoResetTimer) {
    clearTimeout(globalRef.__demoResetTimer);
  }
  const now = new Date();
  const nextRun = getNextResetAt(now);
  const delay = Math.max(1, nextRun.getTime() - now.getTime());
  globalRef.__demoResetTimer = setTimeout(() => {
    resetAll("auto");
    scheduleDailyReset(store);
  }, delay);
}

function createMatchInternal(store: InMemoryStore, userA: string, userB: string): Match {
  const existing = findActiveMatch(store, userA, userB);
  if (existing) {
    return existing;
  }
  const match: Match = {
    id: generateId(),
    userA,
    userB,
    createdAt: new Date().toISOString(),
  };
  store.matches.set(match.id, match);
  return match;
}

