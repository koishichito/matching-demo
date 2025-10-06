export type UserProfile = {
  id: string;
  nickname: string;
  ageVerified: boolean;
  tags: string[];
  bio?: string;
  vibe?: string;
  budget?: string;
  lastActiveAt: string;
  createdAt: string;
};

export type Presence = {
  userId: string;
  gridLat: number;
  gridLng: number;
  lat: number;
  lng: number;
  locationLabel?: string;
  since: string;
  expiresAt: string;
};

export type Proposal = {
  id: string;
  from: string;
  to: string;
  createdAt: string;
  status: "pending" | "accepted" | "declined";
  respondedAt?: string;
  matchId?: string;
};

export type Match = {
  id: string;
  userA: string;
  userB: string;
  createdAt: string;
  closedAt?: string;
};

export type Message = {
  id: string;
  matchId: string;
  from: string;
  text: string;
  sentAt: string;
};

export type Report = {
  id: string;
  reporterId: string;
  reportedUserId: string;
  reason: string;
  details?: string;
  createdAt: string;
};

export type NearbyListing = {
  user: UserProfile;
  presence: Presence;
  distanceKm: number;
  affinityScore: number;
};

export type BroadcastEvent =
  | { type: "presence:update"; payload: Presence }
  | { type: "presence:remove"; payload: { userId: string } }
  | { type: "proposal:created"; payload: Proposal }
  | { type: "proposal:accepted"; payload: { proposalId: string; match: Match } }
  | { type: "match:closed"; payload: { matchId: string } }
  | { type: "message:new"; payload: Message }
  | { type: "reset:run"; payload: { at: string } };
