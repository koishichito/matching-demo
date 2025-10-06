
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BroadcastEvent,
  Match,
  Message,
  NearbyListing,
  Presence,
  Proposal,
  UserProfile,
} from "@/server/types";
import {
  acceptProposalRequest,
  deletePresence,
  fetchLocationPresets,
  fetchMessages,
  fetchNearby,
  fetchUser,
  postMessage,
  postPresence,
  postProposal,
  postReport,
  postReset,
  upsertUserProfile,
} from "@/lib/api";
import type { LocationPreset } from "@/lib/api";
import {
  SessionSnapshot,
  SessionLocation,
  loadSession,
  persistSession,
  clearSession,
} from "@/lib/session";

const WS_URL_ENV = process.env.NEXT_PUBLIC_WS_URL;
const WS_PORT_ENV = process.env.NEXT_PUBLIC_WS_PORT ?? "3333";
const DEFAULT_RADIUS_KM = 3;
const RADIUS_CHOICES = [2, 3, 5, 10];

const TAG_OPTIONS = [
  "Quick drink",
  "Deep conversation",
  "New connections welcome",
  "English friendly",
  "Bar hopping",
  "Work talk",
  "Travel stories",
  "Quiet night",
];

const VIBE_OPTIONS = ["Lively", "Relaxed", "With music", "Casual hang", "Quiet bar"];

const BUDGET_OPTIONS = ["Under JPY 3k", "JPY 3k-5k", "JPY 5k-7k", "JPY 7k+"];

const REPORT_REASONS = [
  "Inappropriate behavior",
  "Profile issue",
  "Spam or solicitation",
  "Other",
];

type OnboardingResult = {
  nickname: string;
  tags: string[];
  vibe?: string;
  budget?: string;
  bio?: string;
  location: SessionLocation;
};

type ProposalMap = Record<string, Proposal>;

type ReportPayload = {
  reason: string;
  details: string;
};

function formatDistance(distanceKm: number) {
  if (Number.isNaN(distanceKm)) return "-";
  if (distanceKm < 0.1) return "under 100m";
  if (distanceKm < 1) return Math.round(distanceKm * 1000) + "m";
  return distanceKm.toFixed(1) + "km";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function Page() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [locationPresets, setLocationPresets] = useState<LocationPreset[]>([]);
  const [selfPresence, setSelfPresence] = useState<Presence | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [nearby, setNearby] = useState<NearbyListing[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [incomingProposals, setIncomingProposals] = useState<ProposalMap>({});
  const [outgoingProposals, setOutgoingProposals] = useState<ProposalMap>({});
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isPresenceLoading, setIsPresenceLoading] = useState(false);
  const [isNearbyLoading, setIsNearbyLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "connected" | "closed">("idle");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingInitial, setOnboardingInitial] = useState<SessionSnapshot | null>(null);
  const [reportTarget, setReportTarget] = useState<{ matchId: string; peerId: string } | null>(null);
  const [knownUsers, setKnownUsers] = useState<Record<string, UserProfile>>({});
  const pendingUserFetch = useRef(new Set<string>());
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (WS_URL_ENV && WS_URL_ENV.length > 0) return WS_URL_ENV;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return protocol + "://" + window.location.hostname + ":" + WS_PORT_ENV;
  }, []);

  const outgoingByTarget = useMemo(() => {
    const map: Record<string, Proposal> = {};
    Object.values(outgoingProposals).forEach((proposal) => {
      map[proposal.to] = proposal;
    });
    return map;
  }, [outgoingProposals]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) => console.error("Service worker registration failed", error));
    }
  }, []);

  useEffect(() => {
    const snapshot = loadSession();
    if (snapshot) {
      setSession(snapshot);
      setOnboardingInitial(snapshot);
    } else {
      setShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchLocationPresets()
      .then((items) => {
        if (active) {
          setLocationPresets(items);
        }
      })
      .catch((error) => {
        console.error("Failed to load location presets", error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.userId) return;
    let cancelled = false;
    fetchUser(session.userId)
      .then((profile) => {
        if (!cancelled) {
          setUser(profile);
          setKnownUsers((prev) => ({ ...prev, [profile.id]: profile }));
        }
      })
      .catch((error) => {
        console.error("Failed to fetch user", error);
        if (!cancelled) {
          setShowOnboarding(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.userId]);

  useEffect(() => {
    if (session && !session.location) {
      setShowOnboarding(true);
    }
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
  const ensureUser = useCallback(
    (userId: string) => {
      if (!userId || userId === session?.userId) return;
      setKnownUsers((prev) => {
        if (prev[userId] || pendingUserFetch.current.has(userId)) {
          return prev;
        }
        pendingUserFetch.current.add(userId);
        fetchUser(userId)
          .then((profile) => {
            setKnownUsers((current) => ({ ...current, [userId]: profile }));
          })
          .catch((error) => {
            console.error("Failed to load peer profile", error);
          })
          .finally(() => {
            pendingUserFetch.current.delete(userId);
          });
        return prev;
      });
    },
    [session?.userId]
  );

  const refreshNearby = useCallback(
    async (targetSession?: SessionSnapshot) => {
      const ctx = targetSession ?? session;
      if (!ctx?.location) return;
      setIsNearbyLoading(true);
      try {
        const items = await fetchNearby({
          lat: ctx.location.lat,
          lng: ctx.location.lng,
          radiusKm,
          selfUserId: ctx.userId,
        });
        setNearby(items);
        setKnownUsers((prev) => {
          const next = { ...prev };
          items.forEach((item) => {
            next[item.user.id] = item.user;
          });
          if (user) {
            next[user.id] = user;
          }
          return next;
        });
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to load nearby list");
      } finally {
        setIsNearbyLoading(false);
      }
    },
    [session, radiusKm, user]
  );

  const scheduleNearbyRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshNearby();
    }, 1200);
  }, [refreshNearby]);

  const handleBroadcast = useCallback(
    (event: BroadcastEvent) => {
      switch (event.type) {
        case "presence:update": {
          if (event.payload.userId === session?.userId) {
            setSelfPresence(event.payload);
          }
          scheduleNearbyRefresh();
          break;
        }
        case "presence:remove": {
          if (event.payload.userId === session?.userId) {
            setSelfPresence(null);
          }
          scheduleNearbyRefresh();
          break;
        }
        case "proposal:created": {
          ensureUser(event.payload.from);
          if (event.payload.to === session?.userId) {
            setIncomingProposals((prev) => ({ ...prev, [event.payload.id]: event.payload }));
            setToast("New meetup proposal received");
          } else if (event.payload.from === session?.userId) {
            setOutgoingProposals((prev) => ({ ...prev, [event.payload.id]: event.payload }));
          }
          break;
        }
        case "proposal:accepted": {
          const { match, proposalId } = event.payload;
          ensureUser(match.userA);
          ensureUser(match.userB);
          if (match.userA === session?.userId || match.userB === session?.userId) {
            setMatches((prev) => ({ ...prev, [match.id]: match }));
            setActiveMatchId(match.id);
            setOutgoingProposals((prev) => {
              const next = { ...prev };
              delete next[proposalId];
              return next;
            });
            setIncomingProposals((prev) => {
              const next = { ...prev };
              delete next[proposalId];
              return next;
            });
            setToast("Chat unlocked");
          }
          break;
        }
        case "match:closed": {
          setMatches((prev) => {
            const next = { ...prev };
            delete next[event.payload.matchId];
            return next;
          });
          setMessages((prev) => {
            const next = { ...prev };
            delete next[event.payload.matchId];
            return next;
          });
          if (activeMatchId === event.payload.matchId) {
            setActiveMatchId(null);
            setToast("Chat closed");
          }
          break;
        }
        case "message:new": {
          ensureUser(event.payload.from);
          setMessages((prev) => {
            const next = { ...prev };
            const arr = next[event.payload.matchId] ? [...next[event.payload.matchId]] : [];
            arr.push(event.payload);
            next[event.payload.matchId] = arr;
            return next;
          });
          break;
        }
        case "reset:run": {
          setSelfPresence(null);
          setIncomingProposals({});
          setOutgoingProposals({});
          setMatches({});
          setMessages({});
          setActiveMatchId(null);
          setToast("Presence reset");
          refreshNearby();
          break;
        }
      }
    },
    [session?.userId, activeMatchId, ensureUser, refreshNearby, scheduleNearbyRefresh]
  );
  useEffect(() => {
    if (!session?.userId || !wsUrl) return;
    setWsStatus("connecting");
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;
    socket.onopen = () => setWsStatus("connected");
    socket.onclose = () => {
      setWsStatus("closed");
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };
    socket.onerror = (error) => {
      console.error("WebSocket error", error);
      setWsStatus("closed");
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BroadcastEvent;
        handleBroadcast(data);
      } catch (error) {
        console.error("Failed to parse realtime event", error);
      }
    };
    return () => {
      socket.close();
    };
  }, [session?.userId, wsUrl, handleBroadcast]);

  useEffect(() => {
    if (session?.location) {
      refreshNearby(session);
    }
  }, [session, session?.location, radiusKm, refreshNearby]);

  useEffect(() => {
    if (!activeMatchId) return;
    let cancelled = false;
    fetchMessages(activeMatchId)
      .then((items) => {
        if (!cancelled) {
          setMessages((prev) => ({ ...prev, [activeMatchId]: items }));
        }
      })
      .catch((error) => console.error("Failed to load messages", error));
    return () => {
      cancelled = true;
    };
  }, [activeMatchId]);
  const handleOnboardingComplete = useCallback(
    async (result: OnboardingResult) => {
      const profile = await upsertUserProfile({
        id: session?.userId,
        nickname: result.nickname.trim(),
        tags: result.tags,
        bio: result.bio?.trim() || undefined,
        vibe: result.vibe,
        budget: result.budget,
      });
      const snapshot: SessionSnapshot = {
        userId: profile.id,
        nickname: profile.nickname,
        tags: profile.tags,
        bio: profile.bio,
        vibe: profile.vibe,
        budget: profile.budget,
        location: result.location,
      };
      setSession(snapshot);
      persistSession(snapshot);
      setUser(profile);
      setSelfPresence(null);
      setIncomingProposals({});
      setOutgoingProposals({});
      setMatches({});
      setMessages({});
      setActiveMatchId(null);
      setKnownUsers((prev) => ({ ...prev, [profile.id]: profile }));
      setShowOnboarding(false);
      setOnboardingInitial(snapshot);
      setToast("Profile saved");
      await refreshNearby(snapshot);
    },
    [session?.userId, refreshNearby]
  );

  const handlePresenceToggle = useCallback(
    async (nextState: boolean) => {
      if (!session?.location || !user) {
        setBanner("Please complete profile and location first");
        setShowOnboarding(true);
        return;
      }
      setIsPresenceLoading(true);
      try {
        if (nextState) {
          const presence = await postPresence({
            userId: user.id,
            lat: session.location.lat,
            lng: session.location.lng,
            locationLabel: session.location.label,
          });
          setSelfPresence(presence);
          setToast("Presence turned on");
        } else {
          await deletePresence(user.id);
          setSelfPresence(null);
          setToast("Presence turned off");
        }
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to update presence");
      } finally {
        setIsPresenceLoading(false);
      }
    },
    [session?.location, user]
  );

  const handleSendProposal = useCallback(
    async (targetUserId: string) => {
      if (!user) return;
      try {
        const proposal = await postProposal(user.id, targetUserId);
        setOutgoingProposals((prev) => ({ ...prev, [proposal.id]: proposal }));
        setToast("Proposal sent");
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to send proposal");
      }
    },
    [user]
  );

  const handleAcceptProposal = useCallback(
    async (proposalId: string) => {
      if (!user) return;
      try {
        const match = await acceptProposalRequest(proposalId, user.id);
        setMatches((prev) => ({ ...prev, [match.id]: match }));
        setActiveMatchId(match.id);
        setIncomingProposals((prev) => {
          const next = { ...prev };
          delete next[proposalId];
          return next;
        });
        setToast("Proposal accepted");
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to accept proposal");
      }
    },
    [user]
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeMatchId || !user) return;
      try {
        const message = await postMessage({ matchId: activeMatchId, from: user.id, text });
        setMessages((prev) => {
          const next = { ...prev };
          const arr = next[activeMatchId] ? [...next[activeMatchId]] : [];
          arr.push(message);
          next[activeMatchId] = arr;
          return next;
        });
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to send message");
      }
    },
    [activeMatchId, user]
  );

  const handleReset = useCallback(async () => {
    try {
      await postReset();
      setToast("Manual reset triggered");
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Failed to reset");
    }
  }, []);

  const handleReportSubmit = useCallback(
    async (payload: ReportPayload) => {
      if (!reportTarget || !user) return;
      try {
        await postReport({
          reporterId: user.id,
          reportedUserId: reportTarget.peerId,
          reason: payload.reason,
          details: payload.details,
        });
        setToast("Report submitted");
        setReportTarget(null);
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Failed to submit report");
      }
    },
    [reportTarget, user]
  );

  const activeMatch = activeMatchId ? matches[activeMatchId] : null;
  const peerId =
    activeMatch && session
      ? activeMatch.userA === session.userId
        ? activeMatch.userB
        : activeMatch.userA
      : null;
  const peerProfile = peerId ? knownUsers[peerId] : undefined;
  const activeMessages = activeMatchId ? messages[activeMatchId] ?? [] : [];
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 pb-16 pt-6">
        <header className="flex flex-col gap-2 rounded-2xl bg-slate-900/70 p-5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-white">JOIN US Demo</h1>
              <p className="text-sm text-slate-300">
                Toggle presence to appear in the nearby list. Accept each other to unlock chat.
              </p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>Realtime: {wsStatus}</div>
              {session?.location && (
                <div>
                  Radius
                  <select
                    value={radiusKm}
                    onChange={(event) => setRadiusKm(Number(event.target.value))}
                    className="ml-1 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs text-slate-200"
                  >
                    {RADIUS_CHOICES.map((value) => (
                      <option key={value} value={value}>
                        {value}km
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {session?.location && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-200">
                {session.location.label ?? "Current location"}
              </span>
              <span>
                lat {session.location.lat.toFixed(3)}, lng {session.location.lng.toFixed(3)}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setOnboardingInitial(session);
                setShowOnboarding(true);
              }}
              className="rounded-full bg-slate-800 px-4 py-2 text-sm transition hover:bg-slate-700"
            >
              Edit profile
            </button>
            <button
              onClick={() => {
                clearSession();
                setSession(null);
                setUser(null);
                setSelfPresence(null);
                setNearby([]);
                setIncomingProposals({});
                setOutgoingProposals({});
                setMatches({});
                setMessages({});
                setActiveMatchId(null);
                setShowOnboarding(true);
                setToast("Local session cleared");
              }}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Reset device session
            </button>
            <button
              onClick={handleReset}
              className="rounded-full border border-rose-500/40 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20"
            >
              Manual reset
            </button>
          </div>
        </header>

        {banner && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {banner}
          </div>
        )}

        <section className="grid gap-5 md:grid-cols-3">
          <div className="space-y-5 md:col-span-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Presence status</h2>
                  <p className="text-sm text-slate-300">
                    Stay in the list while presence is on. Turn off to disappear immediately.
                  </p>
                </div>
                <button
                  onClick={() => handlePresenceToggle(!selfPresence)}
                  disabled={isPresenceLoading || !session?.location || !user}
                  className={cn(
                    "rounded-full px-6 py-2 text-sm font-semibold transition",
                    selfPresence
                      ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:bg-emerald-500/70"
                      : "bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:bg-slate-800/60"
                  )}
                >
                  {selfPresence ? "Presence ON" : "Presence OFF"}
                </button>
              </div>
              {selfPresence && (
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span>Started: {new Date(selfPresence.since).toLocaleTimeString()}</span>
                  <span>Expiry: {new Date(selfPresence.expiresAt).toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            <NearbyList
              items={nearby}
              selfUserId={session?.userId}
              outgoingByTarget={outgoingByTarget}
              onPropose={handleSendProposal}
              loading={isNearbyLoading}
            />
          </div>

          <div className="space-y-5">
            <ProposalInbox
              incoming={incomingProposals}
              outgoing={outgoingProposals}
              knownUsers={knownUsers}
              selfUserId={session?.userId}
              onAccept={handleAcceptProposal}
            />

            <ChatPanel
              match={activeMatch}
              messages={activeMessages}
              selfUserId={session?.userId}
              peer={peerProfile}
              onSend={handleSendMessage}
              onClose={() => setActiveMatchId(null)}
              onReport={() =>
                activeMatch && peerId ? setReportTarget({ matchId: activeMatch.id, peerId }) : null
              }
            />
          </div>
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/90 px-5 py-3 text-sm text-slate-100 shadow-lg">
          {toast}
        </div>
      )}

      <OnboardingModal
        open={showOnboarding}
        presets={locationPresets}
        initial={onboardingInitial}
        onClose={() => setShowOnboarding(false)}
        onComplete={handleOnboardingComplete}
      />

      <ReportDialog
        open={Boolean(reportTarget)}
        reasons={REPORT_REASONS}
        onClose={() => setReportTarget(null)}
        onSubmit={handleReportSubmit}
      />
    </div>
  );
}

type OnboardingModalProps = {
  open: boolean;
  presets: LocationPreset[];
  initial: SessionSnapshot | null;
  onClose: () => void;
  onComplete: (result: OnboardingResult) => Promise<void>;
};

function OnboardingModal({ open, presets, initial, onClose, onComplete }: OnboardingModalProps) {
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(Boolean(initial));
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(initial?.tags ?? []);
  const [vibe, setVibe] = useState(initial?.vibe ?? "");
  const [budget, setBudget] = useState(initial?.budget ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [selectedLocation, setSelectedLocation] = useState<SessionLocation | null>(
    initial?.location ?? null
  );
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAgeConfirmed(Boolean(initial));
    setNickname(initial?.nickname ?? "");
    setSelectedTags(initial?.tags ?? []);
    setVibe(initial?.vibe ?? "");
    setBudget(initial?.budget ?? "");
    setBio(initial?.bio ?? "");
    setSelectedLocation(initial?.location ?? null);
    setSelectedPreset("");
    setError(null);
  }, [initial, open]);

  useEffect(() => {
    if (!selectedLocation || presets.length === 0) return;
    if (selectedLocation.source === "manual") {
      const preset = presets.find(
        (item) => item.lat === selectedLocation.lat && item.lng === selectedLocation.lng
      );
      if (preset) {
        setSelectedPreset(preset.key);
      }
    }
  }, [selectedLocation, presets]);

  if (!open) return null;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]
    );
  };

  const handleUseGeolocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus("error");
      setError("Geolocation is not available on this device");
      return;
    }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSelectedLocation({
          lat: Number(position.coords.latitude.toFixed(5)),
          lng: Number(position.coords.longitude.toFixed(5)),
          label: "Current location",
          source: "geolocation",
        });
        setSelectedPreset("");
        setGeoStatus("idle");
        setError(null);
      },
      () => {
        setGeoStatus("error");
        setError("Unable to read location");
      },
      { enableHighAccuracy: false, timeout: 7000 }
    );
  };

  const handlePresetChange = (key: string) => {
    setSelectedPreset(key);
    const preset = presets.find((item) => item.key === key);
    if (preset) {
      setSelectedLocation({
        lat: preset.lat,
        lng: preset.lng,
        label: preset.label,
        source: "manual",
      });
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ageConfirmed) {
      setError("Please confirm you are over 20 for the demo");
      return;
    }
    if (!nickname.trim()) {
      setError("Nickname is required");
      return;
    }
    if (!selectedLocation) {
      setError("Select a location to appear in");
      return;
    }
    setSubmitting(true);
    try {
      await onComplete({
        nickname: nickname.trim(),
        tags: selectedTags,
        vibe: vibe || undefined,
        budget: budget || undefined,
        bio: bio || undefined,
        location: selectedLocation,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {initial ? "Update profile" : "Get ready"}
            </h2>
            <p className="text-sm text-slate-300">
              Minimal info for this demo. Stored locally only.
            </p>
          </div>
          {initial && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          )}
        </div>

        <div className="mt-5 space-y-5 text-sm">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(event) => setAgeConfirmed(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
            />
            <span>I confirm I am over 20 and will use this demo responsibly.</span>
          </label>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Nickname
            </label>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Example: Aya"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Tags (multiple)
            </label>
            <div className="flex flex-wrap gap-2">
              {TAG_OPTIONS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      active
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                        : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Desired vibe
              </label>
              <select
                value={vibe}
                onChange={(event) => setVibe(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="">Not set</option>
                {VIBE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Budget per person
              </label>
              <select
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="">Not set</option>
                {BUDGET_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Bio (optional)
            </label>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={3}
              placeholder="Example: Exploring wine bars and open to sharing recommendations."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Location for presence
              </span>
              <button
                type="button"
                onClick={handleUseGeolocation}
                className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-60"
                disabled={geoStatus === "loading"}
              >
                {geoStatus === "loading" ? "Locating..." : "Use device location"}
              </button>
            </div>

            <select
              value={selectedPreset}
              onChange={(event) => handlePresetChange(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">Choose from presets</option>
              {presets.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>

            {selectedLocation && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <div className="font-semibold text-emerald-100">
                  {selectedLocation.label ?? "Current location"}
                </div>
                <div>
                  lat {selectedLocation.lat.toFixed(4)} / lng {selectedLocation.lng.toFixed(4)} (
                  {selectedLocation.source === "manual" ? "preset" : "geolocation"})
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          {initial && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:bg-emerald-500/60"
          >
            {submitting ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

type NearbyListProps = {
  items: NearbyListing[];
  selfUserId?: string;
  outgoingByTarget: Record<string, Proposal>;
  onPropose: (userId: string) => void;
  loading: boolean;
};

function NearbyList({
  items,
  selfUserId,
  outgoingByTarget,
  onPropose,
  loading,
}: NearbyListProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Nearby people</h2>
        {loading && <span className="text-xs text-slate-400">Refreshing...</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">
          Turn presence on to appear in the list. Switch presets to simulate other locations.
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((entry) => {
            const isSelf = entry.user.id === selfUserId;
            const outgoing = outgoingByTarget[entry.user.id];
            return (
              <div
                key={entry.user.id}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-slate-700",
                  isSelf && "border-emerald-500/60 bg-emerald-500/10"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{entry.user.nickname}</div>
                    <div className="text-xs text-slate-400">
                      {isSelf ? "You" : formatDistance(entry.distanceKm)} · score {Math.round(entry.affinityScore)}
                    </div>
                  </div>
                  {!isSelf && (
                    <button
                      onClick={() => onPropose(entry.user.id)}
                      disabled={Boolean(outgoing)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold transition",
                        outgoing
                          ? "bg-slate-800 text-slate-400"
                          : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                      )}
                    >
                      {outgoing ? "Sent" : "Invite"}
                    </button>
                  )}
                </div>
                {entry.user.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                    {entry.user.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {entry.user.bio && <p className="text-sm text-slate-200">{entry.user.bio}</p>}
                {entry.presence.locationLabel && (
                  <div className="text-xs text-slate-400">
                    {entry.presence.locationLabel} · since {new Date(entry.presence.since).toLocaleTimeString()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ProposalInboxProps = {
  incoming: ProposalMap;
  outgoing: ProposalMap;
  knownUsers: Record<string, UserProfile>;
  selfUserId?: string;
  onAccept: (proposalId: string) => void;
};

function ProposalInbox({ incoming, outgoing, knownUsers, onAccept }: ProposalInboxProps) {
  const incomingList = Object.values(incoming).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const outgoingList = Object.values(outgoing).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="mb-3 text-lg font-semibold text-white">Meetup proposals</h2>
      <div className="space-y-4 text-sm text-slate-200">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            Incoming
            <span>{incomingList.length}</span>
          </div>
          {incomingList.length === 0 ? (
            <p className="text-xs text-slate-500">No incoming proposals yet.</p>
          ) : (
            <div className="space-y-2">
              {incomingList.map((proposal) => {
                const sender = knownUsers[proposal.from];
                return (
                  <div
                    key={proposal.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {sender?.nickname ?? proposal.from}
                      </div>
                      <div className="text-xs text-slate-400">
                        {new Date(proposal.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button
                      onClick={() => onAccept(proposal.id)}
                      className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                    >
                      Accept
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            Outgoing
            <span>{outgoingList.length}</span>
          </div>
          {outgoingList.length === 0 ? (
            <p className="text-xs text-slate-500">You have not sent any proposals.</p>
          ) : (
            <div className="space-y-2">
              {outgoingList.map((proposal) => {
                const receiver = knownUsers[proposal.to];
                return (
                  <div
                    key={proposal.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {receiver?.nickname ?? proposal.to}
                      </div>
                      <div className="text-xs text-slate-400">
                        {new Date(proposal.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                      {proposal.status === "pending" ? "Waiting" : "Matched"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type ChatPanelProps = {
  match: Match | null;
  messages: Message[];
  selfUserId?: string;
  peer?: UserProfile;
  onSend: (text: string) => void;
  onClose: () => void;
  onReport: () => void;
};

function ChatPanel({ match, messages, selfUserId, peer, onSend, onClose, onReport }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  if (!match || !selfUserId) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
        Accept a proposal to unlock chat.
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{peer?.nickname ?? "Chat"}</h2>
          <p className="text-xs text-slate-400">
            {new Date(match.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReport}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            Report
          </button>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const isSelf = message.from === selfUserId;
            return (
              <div key={message.id} className={cn("flex", isSelf ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                    isSelf
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-100"
                  )}
                >
                  <div>{message.text}</div>
                  <div className="mt-1 text-[10px] opacity-70">
                    {new Date(message.sentAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={handleSubmit} className="border-t border-slate-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-full border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:bg-emerald-500/60"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

type ReportDialogProps = {
  open: boolean;
  reasons: string[];
  onClose: () => void;
  onSubmit: (payload: ReportPayload) => void;
};

function ReportDialog({ open, reasons, onClose, onSubmit }: ReportDialogProps) {
  const [reason, setReason] = useState(reasons[0] ?? "");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(reasons[0] ?? "");
      setDetails("");
      setSubmitting(false);
    }
  }, [open, reasons]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    await onSubmit({ reason, details });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 text-sm text-slate-100 shadow-2xl"
      >
        <h3 className="text-base font-semibold text-white">Report user</h3>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reason
          </label>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/30"
          >
            {reasons.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Details (optional)
          </label>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value.slice(0, 280))}
            rows={3}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/30"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-rose-400 disabled:bg-rose-500/60"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}


