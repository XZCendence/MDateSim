import { DbConnection, tables } from "@bindings/index";

/**
 * One shared SpacetimeDB connection for the whole app.
 * Bindings live in Server/src/module_bindings (`@bindings`).
 * The selected date is the caller's `game_session` row.
 */
export type SessionSnapshot = {
  ready: boolean;
  dateId: string | null;
  startedAt: string | null;
};

const EMPTY: SessionSnapshot = { ready: false, dateId: null, startedAt: null };
const TOKEN_KEY = "mdatesim.spacetime.token";

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string | undefined): void {
  if (!token) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode, quota, etc. */
  }
}

function hasSpaceId(spaceId: string | undefined): boolean {
  return typeof spaceId === "string" && spaceId.length > 0;
}

let conn: DbConnection | undefined;
let identityHex: string | undefined;
let snapshot: SessionSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: SessionSnapshot): void {
  if (
    snapshot.ready === next.ready &&
    snapshot.dateId === next.dateId &&
    snapshot.startedAt === next.startedAt
  ) {
    return;
  }
  snapshot = next;
  emit();
}

function timestampIso(timestamp: { microsSinceUnixEpoch: bigint }): string {
  return new Date(Number(timestamp.microsSinceUnixEpoch / 1000n)).toISOString();
}

function sessionFor(
  db: {
    gameSession: {
      iter(): Iterable<{
        player: { toHexString(): string };
        dateId: string;
        startedAt: { microsSinceUnixEpoch: bigint };
      }>;
    };
  },
  playerHex: string | undefined,
): { dateId: string; startedAt: { microsSinceUnixEpoch: bigint } } | undefined {
  if (!playerHex) return undefined;
  for (const row of db.gameSession.iter()) {
    if (row.player.toHexString() === playerHex) return row;
  }
  return undefined;
}

function refresh(db: {
  gameSession: {
    iter(): Iterable<{
      player: { toHexString(): string };
      dateId: string;
      startedAt: { microsSinceUnixEpoch: bigint };
    }>;
  };
}): void {
  if (!identityHex) return;
  const mine = sessionFor(db, focusPlayerHex()) ?? sessionFor(db, identityHex);
  setSnapshot({
    ready: true,
    dateId: mine?.dateId ?? null,
    startedAt: mine ? timestampIso(mine.startedAt) : null,
  });
}

/**
 * Relationship state for the current player (IRL dates, affection, the open
 * demand). Bumped on every row change so `useSyncExternalStore` re-renders.
 */
export type MyRows = {
  irlDates: ReturnType<typeof readIrlDates>;
  affection: number;
  demand: string | undefined;
  demandMet: boolean;
  phase: string;
  /** True once this player's first text has linked their iMessage thread to the session. */
  linked: boolean;
  /** This player's conversation, oldest first (texts and spoken IRL lines alike). */
  messages: { id: bigint; role: string; text: string }[];
  /**
   * Conversation to mirror on the laptop. Same as `messages` when this browser is the
   * linked player; otherwise the newest linked thread (a refresh used to mint a new
   * identity and leave the QR screen staring at an empty session).
   */
  liveMessages: { id: bigint; role: string; text: string }[];
};

let rowsVersion = 0;
let rowsCache: { version: number; value: MyRows } | undefined;

function readIrlDates() {
  if (!conn || !identityHex) return [];
  return [...conn.db.irlDate.iter()].filter((r) => r.player.toHexString() === identityHex);
}

function bumpRows(): void {
  rowsVersion += 1;
  emit();
}

function messagesFor(playerHex: string): { id: bigint; role: string; text: string }[] {
  if (!conn) return [];
  return [...conn.db.message.iter()]
    .filter((m) => m.player.toHexString() === playerHex)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(-12)
    .map((m) => ({ id: m.id, role: m.role, text: m.text }));
}

/** Player whose thread the laptop should mirror (this tab, or the newest linked one). */
function focusPlayerHex(): string | undefined {
  if (!conn) return identityHex;
  if (identityHex && messagesFor(identityHex).length > 0) return identityHex;
  if (identityHex) {
    for (const g of conn.db.gameSession.iter()) {
      if (g.player.toHexString() === identityHex && hasSpaceId(g.spaceId)) return identityHex;
    }
  }
  const linked = new Set<string>();
  for (const g of conn.db.gameSession.iter()) {
    if (hasSpaceId(g.spaceId)) linked.add(g.player.toHexString());
  }
  let best: { player: string; t: bigint } | undefined;
  for (const m of conn.db.message.iter()) {
    const player = m.player.toHexString();
    if (!linked.has(player)) continue;
    const t = m.sentAt.microsSinceUnixEpoch;
    if (!best || t > best.t) best = { player, t };
  }
  return best?.player ?? identityHex;
}

export function getMyRows(): MyRows {
  if (rowsCache?.version === rowsVersion) return rowsCache.value;
  const focus = focusPlayerHex();
  let affection = 0;
  let demand: string | undefined;
  let demandMet = false;
  let phase = "texting";
  let linked = false;
  if (conn && focus) {
    for (const g of conn.db.gameSession.iter()) {
      if (g.player.toHexString() === focus) linked = hasSpaceId(g.spaceId);
    }
    for (const a of conn.db.affection.iter()) {
      if (a.player.toHexString() === focus) affection = a.value;
    }
    for (const d of conn.db.dateState.iter()) {
      if (d.player.toHexString() === focus) {
        demand = d.demand;
        demandMet = d.demandMet;
        phase = d.phase;
      }
    }
  }
  const messages = identityHex ? messagesFor(identityHex) : [];
  const liveMessages = messages.length > 0 ? messages : messagesFor(focus ?? "");
  const value: MyRows = {
    irlDates: readIrlDates(),
    affection,
    demand,
    demandMet,
    phase,
    linked,
    messages,
    liveMessages,
  };
  rowsCache = { version: rowsVersion, value };
  return value;
}

/** This browser's player identity (hex), once connected. */
export function getIdentityHex(): string | undefined {
  return identityHex;
}

export function subscribeSpacetime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSpacetimeSnapshot(): SessionSnapshot {
  return snapshot;
}

export function getSpacetime(): DbConnection | undefined {
  if (conn) return conn;
  const uri = import.meta.env.VITE_SPACETIMEDB_HOST;
  const databaseName = import.meta.env.VITE_SPACETIMEDB_DB_NAME;
  if (!uri || !databaseName) {
    console.error(
      "[spacetime] set VITE_SPACETIMEDB_HOST and VITE_SPACETIMEDB_DB_NAME (see Client/.env.example)",
    );
    return undefined;
  }
  conn = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(databaseName)
    .withToken(readToken())
    .onConnect((c, identity, token) => {
      writeToken(token);
      identityHex = identity.toHexString();
      console.info("[spacetime] connected as", identityHex.slice(0, 16));
      c.db.gameSession.onInsert((ctx) => (refresh(ctx.db), bumpRows()));
      c.db.gameSession.onUpdate((ctx) => (refresh(ctx.db), bumpRows()));
      c.db.gameSession.onDelete((ctx) => (refresh(ctx.db), bumpRows()));
      for (const table of [c.db.irlDate, c.db.affection, c.db.dateState, c.db.message]) {
        table.onInsert(bumpRows);
        table.onUpdate(bumpRows);
        table.onDelete(bumpRows);
      }
      c.subscriptionBuilder()
        .onApplied((ctx) => {
          refresh(ctx.db);
          bumpRows();
        })
        .onError((ctx) => console.error("[spacetime] subscription error", ctx.event))
        .subscribe([
          tables.gameSession,
          tables.irlDate,
          tables.affection,
          tables.dateState,
          tables.message,
        ]);
    })
    .onConnectError((_c, err) => console.error("[spacetime] connect error", err))
    .build();
  return conn;
}
