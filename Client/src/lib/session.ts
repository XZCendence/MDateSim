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
  startedAt: string;
  irlDates: IrlDate[];
}

const KEY = "mdatesim.session";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export function startSession(dateId: string): Session {
  const s: Session = { dateId, startedAt: new Date().toISOString(), irlDates: [] };
  saveSession(s);
  return s;
}
