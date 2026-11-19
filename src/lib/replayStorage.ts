import type { MatchReplayRecord } from '../shared/types';

const REPLAY_LIST_KEY = 'shayon_fire_max_replays_v1';
const MAX_STORED_REPLAYS = 3;

export function saveMatchReplay(record: MatchReplayRecord): MatchReplayRecord {
  if (typeof window === 'undefined' || !window.localStorage) return record;

  // Enforce strict 60-second tail window before persisting
  const frames = record.frames;
  let trimmedRecord = record;
  if (frames.length > 0) {
    const endT = frames[frames.length - 1].t;
    const startT = Math.max(0, endT - 60);
    const tailFrames = frames.filter((f) => f.t >= startT);
    const tailHighlights = record.highlights.filter((h) => h.t >= startT);
    trimmedRecord = {
      ...record,
      frames: tailFrames,
      highlights: tailHighlights,
      durationSeconds: Number((endT - (tailFrames[0]?.t ?? endT)).toFixed(2)),
    };
  }

  const existing = loadStoredReplays().filter((r) => r.id !== trimmedRecord.id);
  const nextList = [trimmedRecord, ...existing].slice(0, MAX_STORED_REPLAYS);

  for (let count = nextList.length; count >= 1; count--) {
    try {
      localStorage.setItem(REPLAY_LIST_KEY, JSON.stringify(nextList.slice(0, count)));
      return trimmedRecord;
    } catch {
      // Quota exceeded: drop oldest replay and retry
    }
  }

  // Last resort: keep only last 30s of current replay
  try {
    const endT = trimmedRecord.frames[trimmedRecord.frames.length - 1]?.t ?? 0;
    const compact: MatchReplayRecord = {
      ...trimmedRecord,
      frames: trimmedRecord.frames.filter((f) => f.t >= endT - 30),
      highlights: trimmedRecord.highlights.filter((h) => h.t >= endT - 30),
    };
    localStorage.setItem(REPLAY_LIST_KEY, JSON.stringify([compact]));
    return compact;
  } catch {
    return trimmedRecord;
  }
}

export function loadStoredReplays(): MatchReplayRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(REPLAY_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MatchReplayRecord[]) : [];
  } catch {
    return [];
  }
}

export function getLatestMatchReplay(): MatchReplayRecord | null {
  const list = loadStoredReplays();
  return list[0] || null;
}

export function clearStoredReplays(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  localStorage.removeItem(REPLAY_LIST_KEY);
}
