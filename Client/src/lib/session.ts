import { useMemo, useSyncExternalStore } from "react";
import { findDate, type DateProfile } from "../data/dates";

/**
 * Player session kept in localStorage until the game state moves into SpacetimeDB.
 * Shape is intentionally small so it maps 1:1 onto a future `player` table.
 */
export interface IrlDate {
  id: string;
  when: string; // ISO datetime
  activity: string;
}

export interface Session {
  dateId: string;
  character: DateProfile;
  startedAt: string;
  irlDates: IrlDate[];
}

const KEY = "mdatesim.session";
const CHANGE_EVENT = "mdatesim.session.change";

function readStoredSession(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function parseSession(raw: string | null): Session | null {
  try {
    if (!raw) return null;
    const stored = JSON.parse(raw);
    const character = findDate(stored.dateId);
    if (!character || typeof stored.startedAt !== "string" || !Array.isArray(stored.irlDates)) return null;
    // Resolve current assets and names, and upgrade sessions saved before character was added.
    return { ...stored, character };
  } catch { return null; }
}

export function loadSession(): Session | null {
  return parseSession(readStoredSession());
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSession(): Session | null {
  const raw = useSyncExternalStore(subscribe, readStoredSession, () => null);
  return useMemo(() => parseSession(raw), [raw]);
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function startSession(dateId: string): Session {
  const character = findDate(dateId);
  if (!character) throw new Error(`Unknown date: ${dateId}`);
  const existing = loadSession();
  if (existing?.dateId === dateId) return existing;
  const s: Session = { dateId, character, startedAt: new Date().toISOString(), irlDates: [] };
  saveSession(s);
  return s;
}
