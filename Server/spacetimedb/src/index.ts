import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { DATE_IDS } from './dateIds';
const PHASES = ['texting', 'irl'] as const;
const DEMANDS = [
  'look',
  'beg',
  'kneel',
  'bow',
  'jacks',
  'dance',
  'heart',
  'blow_kiss',
  'kiss',
  'squat',
  'still',
  'wave',
] as const; // keep in sync with Irl/gestures.py DATE_DETECTORS

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    createdAt: t.timestamp(),
  }
);

const gameSession = table(
  { name: 'game_session', public: true },
  {
    player: t.identity().primaryKey(),
    dateId: t.string(),
    startedAt: t.timestamp(),
    spaceId: t.option(t.string()),
  }
);

const dateState = table(
  { name: 'date_state', public: true },
  {
    player: t.identity().primaryKey(),
    phase: t.string(),
    demand: t.option(t.string()),
    demandMet: t.bool(),
  }
);

// ---- Conversation + relationship state (keyed by player identity) ----
// Written by Server/src/imessage.ts (the texting loop) and Irl/ (Kinect),
// which connect with their own identities, so these reducers take the player
// explicitly instead of using ctx.sender.

const message = table(
  { name: 'message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    player: t.identity().index('btree'),
    role: t.string(), // "user" | "assistant"
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

const affection = table(
  { name: 'affection', public: true },
  {
    player: t.identity().primaryKey(),
    value: t.i32(), // -100 .. 100
  }
);

const irlDate = table(
  { name: 'irl_date', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    player: t.identity().index('btree'),
    scheduledFor: t.timestamp(),
    activity: t.string(),
    status: t.string(), // "scheduled" | "active" | "done" | "cancelled"
    createdAt: t.timestamp(),
  }
);

const gestureEvent = table(
  { name: 'gesture_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    player: t.identity().index('btree'),
    gesture: t.string(), // one of DEMANDS
    success: t.bool(),
    at: t.timestamp(),
  }
);

// What the Kinect currently sees of a player on an IRL date. Written by Irl/date_runner.py,
// read by the director (Server/src/director.ts) so the date knows you walked up or looked away.
const presence = table(
  { name: 'presence', public: true },
  {
    player: t.identity().primaryKey(),
    inView: t.bool(),
    facing: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  player,
  gameSession,
  dateState,
  message,
  affection,
  irlDate,
  gestureEvent,
  presence,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function isOneOf(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}

function requirePlayer(ctx: Ctx): void {
  if (ctx.db.player.identity.find(ctx.sender) == null) {
    throw new SenderError('no player for sender');
  }
}

function requireDateState(ctx: Ctx) {
  const row = ctx.db.dateState.player.find(ctx.sender);
  if (row == null) {
    throw new SenderError('no date state for sender');
  }
  return row;
}

function requireDateId(dateId: string): void {
  if (!isOneOf(dateId, DATE_IDS)) {
    throw new SenderError('dateId must be bianca or rin');
  }
}

function requirePhase(phase: string): void {
  if (!isOneOf(phase, PHASES)) {
    throw new SenderError('phase must be texting or irl');
  }
}

function requireDemand(demand: string): void {
  if (!isOneOf(demand, DEMANDS)) {
    throw new SenderError(`demand must be one of ${DEMANDS.join(', ')}`);
  }
}

function optionIsEmpty(value: string | undefined): boolean {
  return value == null || value === '';
}

export const init = spacetimedb.init(_ctx => {
  // Called when the module is initially published
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing == null) {
    ctx.db.player.insert({
      identity: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  // Leave the player row in place. But a closed tab, crashed browser, or sleeping laptop must
  // not leave the date talking to an empty room: walking away ends the IRL date.
  const state = ctx.db.dateState.player.find(ctx.sender);
  if (state != null && state.phase === 'irl') {
    ctx.db.dateState.player.update({ ...state, phase: 'texting', demand: undefined, demandMet: false });
  }
});

/**
 * Start a date, or start over / switch to another person.
 * Keeps a linked iMessage spaceId and clears this sender's thread, affection,
 * demand, and IRL plans. An unlinked session stays unclaimed for the intro text.
 */
export const pickDate = spacetimedb.reducer(
  { dateId: t.string() },
  (ctx, { dateId }) => {
    requirePlayer(ctx);
    requireDateId(dateId);

    for (const row of [...ctx.db.message.player.filter(ctx.sender)]) {
      ctx.db.message.id.delete(row.id);
    }
    if (ctx.db.affection.player.find(ctx.sender) != null) {
      ctx.db.affection.player.delete(ctx.sender);
    }
    for (const row of [...ctx.db.irlDate.player.filter(ctx.sender)]) {
      ctx.db.irlDate.id.delete(row.id);
    }

    const existing = ctx.db.gameSession.player.find(ctx.sender);
    if (existing != null) {
      ctx.db.gameSession.player.update({
        ...existing,
        dateId,
        startedAt: ctx.timestamp,
      });
    } else {
      ctx.db.gameSession.insert({
        player: ctx.sender,
        dateId,
        startedAt: ctx.timestamp,
        spaceId: undefined,
      });
    }

    const state = ctx.db.dateState.player.find(ctx.sender);
    if (state != null) {
      ctx.db.dateState.player.update({
        ...state,
        phase: 'texting',
        demand: undefined,
        demandMet: false,
      });
    } else {
      ctx.db.dateState.insert({
        player: ctx.sender,
        phase: 'texting',
        demand: undefined,
        demandMet: false,
      });
    }
  }
);

export const clearSession = spacetimedb.reducer(ctx => {
  if (ctx.db.gameSession.player.find(ctx.sender) != null) {
    ctx.db.gameSession.player.delete(ctx.sender);
  }
  if (ctx.db.dateState.player.find(ctx.sender) != null) {
    ctx.db.dateState.player.delete(ctx.sender);
  }
});

export const setPhase = spacetimedb.reducer(
  { phase: t.string() },
  (ctx, { phase }) => {
    const state = requireDateState(ctx);
    requirePhase(phase);
    ctx.db.dateState.player.update({ ...state, phase });
  }
);

export const setDemand = spacetimedb.reducer(
  { demand: t.string() },
  (ctx, { demand }) => {
    const state = requireDateState(ctx);
    requireDemand(demand);
    ctx.db.dateState.player.update({
      ...state,
      demand,
      demandMet: false,
    });
  }
);

export const clearDemand = spacetimedb.reducer(ctx => {
  const state = requireDateState(ctx);
  ctx.db.dateState.player.update({
    ...state,
    demand: undefined,
    demandMet: false,
  });
});

export const markDemandMet = spacetimedb.reducer(ctx => {
  const state = requireDateState(ctx);
  if (optionIsEmpty(state.demand)) {
    throw new SenderError('no demand set');
  }
  ctx.db.dateState.player.update({ ...state, demandMet: true });
});

export const claimSession = spacetimedb.reducer(
  { dateId: t.string(), spaceId: t.string() },
  (ctx, { dateId, spaceId }) => {
    requireDateId(dateId);
    if (spaceId === '') {
      throw new SenderError('spaceId must not be empty');
    }

    const matches = [...ctx.db.gameSession.iter()].filter(
      row => row.dateId === dateId && optionIsEmpty(row.spaceId)
    );
    if (matches.length !== 1) {
      throw new SenderError(
        matches.length === 0
          ? 'no unclaimed session for dateId'
          : 'more than one unclaimed session for dateId'
      );
    }

    const session = matches[0]!;
    ctx.db.gameSession.player.update({ ...session, spaceId });
  }
);

/** Like claimSession, but when several lobby sessions for `dateId` are unclaimed, take the
 * newest one (the player who just clicked) instead of refusing. Stale ones stay unclaimed. */
export const claimLatestSession = spacetimedb.reducer(
  { dateId: t.string(), spaceId: t.string() },
  (ctx, { dateId, spaceId }) => {
    requireDateId(dateId);
    if (spaceId === '') {
      throw new SenderError('spaceId must not be empty');
    }
    // Drop any older link this thread had, so one spaceId maps to one live session.
    for (const row of [...ctx.db.gameSession.iter()]) {
      if (row.spaceId === spaceId) {
        ctx.db.gameSession.player.update({ ...row, spaceId: undefined });
      }
    }
    let newest: ReturnType<typeof ctx.db.gameSession.player.find> = null;
    for (const row of ctx.db.gameSession.iter()) {
      if (row.dateId !== dateId || !optionIsEmpty(row.spaceId)) continue;
      if (newest == null || row.startedAt.microsSinceUnixEpoch > newest.startedAt.microsSinceUnixEpoch) {
        newest = row;
      }
    }
    if (newest == null) {
      throw new SenderError('no unclaimed session for dateId');
    }
    ctx.db.gameSession.player.update({ ...newest, spaceId });
  }
);

/** Detach an iMessage thread from whatever session holds it (used by /reset). */
export const unlinkSpace = spacetimedb.reducer({ spaceId: t.string() }, (ctx, { spaceId }) => {
  for (const row of [...ctx.db.gameSession.iter()]) {
    if (row.spaceId === spaceId) {
      ctx.db.gameSession.player.update({ ...row, spaceId: undefined });
    }
  }
});

// ---- Conversation + relationship reducers ----

const ROLES = ['user', 'assistant'] as const;
const DATE_STATUSES = ['scheduled', 'active', 'done', 'cancelled'] as const;
const AFFECTION_MIN = -100;
const AFFECTION_MAX = 100;

function clampAffection(value: number): number {
  return Math.max(AFFECTION_MIN, Math.min(AFFECTION_MAX, value));
}

function bumpAffection(ctx: Ctx, player: Identity, delta: number): void {
  const row = ctx.db.affection.player.find(player);
  if (row == null) {
    ctx.db.affection.insert({ player, value: clampAffection(delta) });
  } else {
    ctx.db.affection.player.update({ ...row, value: clampAffection(row.value + delta) });
  }
}

function requireSessionFor(ctx: Ctx, player: Identity): void {
  if (ctx.db.gameSession.player.find(player) == null) {
    throw new SenderError('no game session for player');
  }
}

/** Append one line of the iMessage conversation. Called by the texting loop. */
export const logMessage = spacetimedb.reducer(
  { player: t.identity(), role: t.string(), text: t.string() },
  (ctx, { player, role, text }) => {
    requireSessionFor(ctx, player);
    if (!isOneOf(role, ROLES)) {
      throw new SenderError('role must be user or assistant');
    }
    ctx.db.message.insert({ id: 0n, player, role, text, sentAt: ctx.timestamp });
  }
);

/** Forget the conversation (keeps the session and affection). */
export const clearMessages = spacetimedb.reducer(
  { player: t.identity() },
  (ctx, { player }) => {
    for (const row of [...ctx.db.message.player.filter(player)]) {
      ctx.db.message.id.delete(row.id);
    }
  }
);

export const adjustAffection = spacetimedb.reducer(
  { player: t.identity(), delta: t.i32() },
  (ctx, { player, delta }) => {
    requireSessionFor(ctx, player);
    bumpAffection(ctx, player, delta);
  }
);

/** The player (from the lobby) books an IRL date. */
export const scheduleIrlDate = spacetimedb.reducer(
  { scheduledFor: t.timestamp(), activity: t.string() },
  (ctx, { scheduledFor, activity }) => {
    requireSessionFor(ctx, ctx.sender);
    if (activity === '') {
      throw new SenderError('activity must not be empty');
    }
    ctx.db.irlDate.insert({
      id: 0n,
      player: ctx.sender,
      scheduledFor,
      activity,
      status: 'scheduled',
      createdAt: ctx.timestamp,
    });
  }
);

export const setIrlDateStatus = spacetimedb.reducer(
  { id: t.u64(), status: t.string() },
  (ctx, { id, status }) => {
    const row = ctx.db.irlDate.id.find(id);
    if (row == null) {
      throw new SenderError('no irl date with that id');
    }
    if (!isOneOf(status, DATE_STATUSES)) {
      throw new SenderError('status must be scheduled, active, done, or cancelled');
    }
    ctx.db.irlDate.id.update({ ...row, status });
  }
);

/** Texting loop (a different identity) sets or clears a demand on the player's behalf. */
export const setDemandFor = spacetimedb.reducer(
  { player: t.identity(), demand: t.string() },
  (ctx, { player, demand }) => {
    const state = ctx.db.dateState.player.find(player);
    if (state == null) {
      throw new SenderError('no date state for player');
    }
    if (demand === '') {
      ctx.db.dateState.player.update({ ...state, demand: undefined, demandMet: false });
      return;
    }
    requireDemand(demand);
    ctx.db.dateState.player.update({ ...state, demand, demandMet: false });
  }
);

/**
 * The player steps into the IRL date on the laptop. There is one Kinect, so this ends anyone
 * else's IRL date, and it starts from a clean slate: no leftover demand.
 */
export const beginIrlDate = spacetimedb.reducer(ctx => {
  const mine = requireDateState(ctx);
  for (const row of [...ctx.db.dateState.iter()]) {
    if (row.phase === 'irl' && !row.player.isEqual(ctx.sender)) {
      ctx.db.dateState.player.update({ ...row, phase: 'texting', demand: undefined, demandMet: false });
    }
  }
  ctx.db.dateState.player.update({ ...mine, phase: 'irl', demand: undefined, demandMet: false });
});

/** Leave the IRL date: back to texting, any open demand dropped. */
export const endIrlDate = spacetimedb.reducer(ctx => {
  const mine = requireDateState(ctx);
  ctx.db.dateState.player.update({ ...mine, phase: 'texting', demand: undefined, demandMet: false });
});

/** The director ends a date on the player's behalf (e.g. they walked off and never came back). */
export const endIrlDateFor = spacetimedb.reducer({ player: t.identity() }, (ctx, { player }) => {
  const state = ctx.db.dateState.player.find(player);
  if (state != null && state.phase === 'irl') {
    ctx.db.dateState.player.update({ ...state, phase: 'texting', demand: undefined, demandMet: false });
  }
});

/** Kinect heartbeat: is the player in frame, and are they facing the camera? */
export const reportPresence = spacetimedb.reducer(
  { player: t.identity(), inView: t.bool(), facing: t.bool() },
  (ctx, { player, inView, facing }) => {
    const row = ctx.db.presence.player.find(player);
    if (row == null) {
      ctx.db.presence.insert({ player, inView, facing, updatedAt: ctx.timestamp });
    } else {
      ctx.db.presence.player.update({ player, inView, facing, updatedAt: ctx.timestamp });
    }
  }
);

/** Kinect reports a gesture attempt; affection moves with it and the open demand is resolved. */
export const recordGesture = spacetimedb.reducer(
  { player: t.identity(), gesture: t.string(), success: t.bool(), affectionDelta: t.i32() },
  (ctx, { player, gesture, success, affectionDelta }) => {
    requireSessionFor(ctx, player);
    requireDemand(gesture);
    ctx.db.gestureEvent.insert({ id: 0n, player, gesture, success, at: ctx.timestamp });
    bumpAffection(ctx, player, affectionDelta);
    const state = ctx.db.dateState.player.find(player);
    if (state != null && state.demand === gesture && success) {
      ctx.db.dateState.player.update({ ...state, demandMet: true });
    }
  }
);
