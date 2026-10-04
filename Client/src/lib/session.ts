import { useMemo, useSyncExternalStore } from "react";
import { findDate, type DateProfile } from "../data/dates";
import { getSpacetimeSnapshot, subscribeSpacetime } from "./spacetime";

/**
 * The selected date comes from the caller's `game_session` row.
 * localStorage only keeps scheduled IRL dates until those move into SpacetimeDB.
 * Start over / switching dates clears them. Continue leaves them alone.
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

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parseIrlDates(raw: string | null): IrlDate[] {
  try {
    if (!raw) return [];
    const stored = JSON.parse(raw) as { irlDates?: unknown };
    if (!Array.isArray(stored.irlDates)) return [];
    return stored.irlDates.filter(
      (d): d is IrlDate =>
        !!d &&
        typeof d === "object" &&
        typeof (d as IrlDate).id === "string" &&
        typeof (d as IrlDate).when === "string" &&
        typeof (d as IrlDate).activity === "string",
    );
  } catch {
    return [];
  }
}

function subscribeLocal(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function writeIrlDates(irlDates: IrlDate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ irlDates }));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

let seenDateId: string | null | undefined;
let seenStartedAt: string | null | undefined;
subscribeSpacetime(() => {
  const { dateId, startedAt } = getSpacetimeSnapshot();
  const switched = seenDateId != null && dateId != null && seenDateId !== dateId;
  const restarted = seenStartedAt != null && startedAt != null && seenStartedAt !== startedAt;
  if (switched || restarted) {
    writeIrlDates([]);
  }
  seenDateId = dateId;
  seenStartedAt = startedAt;
});

export function useSession(): Session | null {
  const remote = useSyncExternalStore(subscribeSpacetime, getSpacetimeSnapshot, () => ({
    ready: false,
    dateId: null,
    startedAt: null,
  }));
  const raw = useSyncExternalStore(subscribeLocal, readStored, () => null);
  return useMemo(() => {
    const character = findDate(remote.dateId ?? undefined);
    if (!character || !remote.startedAt) return null;
    return {
      dateId: character.id,
      character,
      startedAt: remote.startedAt,
      irlDates: parseIrlDates(raw),
    };
  }, [remote, raw]);
}

export function saveSession(s: Pick<Session, "irlDates"> | null): void {
  writeIrlDates(s?.irlDates ?? []);
}
