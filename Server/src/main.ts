import { Identity } from 'spacetimedb';
import {
  DbConnection,
  ErrorContext,
  EventContext,
} from './module_bindings/index.js';

// Configuration - Bun supports .env files natively
const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'bun-ts';

// Main entry point
async function main(): Promise<void> {
  console.log(`Connecting to SpacetimeDB...`);
  console.log(`  URI: ${HOST}`);
  console.log(`  Module: ${DB_NAME}`);

  const token = await loadToken();

  // Build and establish connection
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect(onConnect)
    .onDisconnect(onDisconnect)
    .onConnectError(onConnectError)
    .build();
}

type TimestampMicros = { microsSinceUnixEpoch: bigint };

function formatTimestamp(timestamp: TimestampMicros): string {
  return new Date(
    Number(timestamp.microsSinceUnixEpoch / 1000n)
  ).toISOString();
}

function formatPlayer(player: {
  identity: Identity;
  createdAt: TimestampMicros;
}): string {
  return `${player.identity.toHexString()} (created ${formatTimestamp(player.createdAt)})`;
}

function formatSession(session: {
  player: Identity;
  dateId: string;
  startedAt: TimestampMicros;
  spaceId?: string;
}): string {
  const space = session.spaceId ? session.spaceId : '(empty)';
  return `${session.player.toHexString()} date=${session.dateId} started=${formatTimestamp(session.startedAt)} space=${space}`;
}

function formatDateState(state: {
  player: Identity;
  phase: string;
  demand?: string;
  demandMet: boolean;
}): string {
  const demand = state.demand ? state.demand : '(none)';
  return `${state.player.toHexString()} phase=${state.phase} demand=${demand} met=${state.demandMet}`;
}

function logTable(label: string, lines: string[]): void {
  console.log(`\nCurrent ${label} (${lines.length}):`);
  if (lines.length === 0) {
    console.log('  (none yet)');
  } else {
    for (const line of lines) {
      console.log(`  - ${line}`);
    }
  }
}

function onConnect(
  conn: DbConnection,
  identity: Identity,
  token: string
): void {
  console.log('\nConnected to SpacetimeDB!');
  console.log(`Identity: ${identity.toHexString().slice(0, 16)}...`);

  // Save token for future connections
  saveToken(token);

  conn.db.player.onInsert((_ctx: EventContext, player) => {
    console.log(`[Inserted] ${formatPlayer(player)}`);
  });
  conn.db.gameSession.onInsert((_ctx: EventContext, session) => {
    console.log(`[Inserted] ${formatSession(session)}`);
  });
  conn.db.dateState.onInsert((_ctx: EventContext, state) => {
    console.log(`[Inserted] ${formatDateState(state)}`);
  });

  // Subscribe to all tables
  conn
    .subscriptionBuilder()
    .onApplied(ctx => {
      logTable('players', [...ctx.db.player.iter()].map(formatPlayer));
      logTable('sessions', [...ctx.db.gameSession.iter()].map(formatSession));
      logTable(
        'date states',
        [...ctx.db.dateState.iter()].map(formatDateState)
      );
    })
    .onError((_ctx, err) => {
      console.error('Subscription error:', err);
    })
    .subscribeToAllTables();
}

function onDisconnect(_ctx: ErrorContext, error?: Error): void {
  if (error) {
    console.error('Disconnected with error:', error);
  } else {
    console.log('Disconnected from SpacetimeDB');
  }
}

function onConnectError(_ctx: ErrorContext, error: Error): void {
  console.error('Connection error:', error);
  process.exit(1);
}

// Token persistence using Bun APIs
const TOKEN_FILE = '.spacetimedb-token';

async function loadToken(): Promise<string | undefined> {
  try {
    const file = Bun.file(TOKEN_FILE);
    if (await file.exists()) {
      const text = await file.text();
      return text.trim() || undefined;
    }
  } catch (err) {
    console.warn('Could not load token:', err);
  }
  return undefined;
}

async function saveToken(token: string): Promise<void> {
  try {
    await Bun.write(TOKEN_FILE, token);
  } catch (err) {
    console.warn('Could not save token:', err);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
