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
  let mine: { dateId: string; startedAt: { microsSinceUnixEpoch: bigint } } | undefined;
  for (const row of db.gameSession.iter()) {
    if (row.player.toHexString() === identityHex) {
      mine = row;
      break;
    }
  }
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

export function getMyRows(): MyRows {
  if (rowsCache?.version === rowsVersion) return rowsCache.value;
  let affection = 0;
  let demand: string | undefined;
  let demandMet = false;
  let phase = "texting";
  if (conn && identityHex) {
    for (const a of conn.db.affection.iter()) {
      if (a.player.toHexString() === identityHex) affection = a.value;
    }
    for (const d of conn.db.dateState.iter()) {
      if (d.player.toHexString() === identityHex) {
        demand = d.demand;
        demandMet = d.demandMet;
        phase = d.phase;
      }
    }
  }
  const value: MyRows = { irlDates: readIrlDates(), affection, demand, demandMet, phase };
  rowsCache = { version: rowsVersion, value };
  return value;
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
    .onConnect((c, identity) => {
      identityHex = identity.toHexString();
      console.info("[spacetime] connected as", identityHex.slice(0, 16));
      c.db.gameSession.onInsert((ctx) => refresh(ctx.db));
      c.db.gameSession.onUpdate((ctx) => refresh(ctx.db));
      c.db.gameSession.onDelete((ctx) => refresh(ctx.db));
      for (const table of [c.db.irlDate, c.db.affection, c.db.dateState]) {
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
        .subscribe([tables.gameSession, tables.irlDate, tables.affection, tables.dateState]);
    })
    .onConnectError((_c, err) => console.error("[spacetime] connect error", err))
    .build();
  return conn;
}
