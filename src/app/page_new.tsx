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
  fetchProposals,
  fetchMatchesForUser,
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
  "サクッと一杯",
  "じっくり会話",
  "新しい出会い歓迎",
  "英語でOK",
  "はしご酒",
  "仕事の話歓迎",
  "旅の話がしたい",
  "静かに飲みたい",
];

const VIBE_OPTIONS = ["にぎやか", "ゆったり", "音楽あり", "カジュアル", "静かなバー"];

const BUDGET_OPTIONS = ["3000円未満", "3000〜5000円", "5000〜7000円", "7000円以上"];

const REPORT_REASONS = [
  "不適切な行為",
  "プロフィールの問題",
  "迷惑・勧誘行為",
  "その他",
];

const WS_STATUS_LABELS = {
  idle: "未接続",
  connecting: "接続中",
  connected: "接続済み",
  closed: "切断",
} as const;

const WS_RETRY_INTERVAL_MS = 15_000;
const FALLBACK_POLL_INTERVAL_MS = 8_000;
const SCORE_TOOLTIP = "距離と共通タグから計算した参考スコアです";
const DISTANCE_LABEL_UNDER_100M = "100m未満";
const REALTIME_FALLBACK_MESSAGE = "リアルタイム接続に失敗したため自動更新モードに切り替えました";


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
  if (distanceKm < 0.1) return DISTANCE_LABEL_UNDER_100M;
  if (distanceKm < 1) return Math.round(distanceKm * 1000) + "m";
  return distanceKm.toFixed(1) + "km";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// アバター画像生成用のヘルパー関数
function generateAvatar(nickname: string, seed?: string): string {
  const initial = nickname.charAt(0).toUpperCase();
  const colors = [
    'bg-gradient-to-br from-pink-400 to-rose-500',
    'bg-gradient-to-br from-purple-400 to-indigo-500',
    'bg-gradient-to-br from-blue-400 to-cyan-500',
    'bg-gradient-to-br from-green-400 to-emerald-500',
    'bg-gradient-to-br from-yellow-400 to-orange-500',
  ];
  const colorIndex = (seed || nickname).charCodeAt(0) % colors.length;
  return colors[colorIndex];
}

