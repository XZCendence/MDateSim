import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';

const DATE_IDS = ['sakura', 'rin'] as const;
const PHASES = ['texting', 'irl'] as const;
const DEMANDS = ['bow', 'squat', 'still', 'jacks', 'wave'] as const;

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

const spacetimedb = schema({ player, gameSession, dateState });
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
    throw new SenderError('dateId must be sakura or rin');
  }
}

function requirePhase(phase: string): void {
  if (!isOneOf(phase, PHASES)) {
    throw new SenderError('phase must be texting or irl');
  }
}

function requireDemand(demand: string): void {
  if (!isOneOf(demand, DEMANDS)) {
    throw new SenderError('demand must be bow, squat, still, jacks, or wave');
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

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {
  // Leave the player row in place.
});

export const pickDate = spacetimedb.reducer(
  { dateId: t.string() },
  (ctx, { dateId }) => {
    requirePlayer(ctx);
    requireDateId(dateId);

    if (ctx.db.gameSession.player.find(ctx.sender) != null) {
      ctx.db.gameSession.player.delete(ctx.sender);
    }
    if (ctx.db.dateState.player.find(ctx.sender) != null) {
      ctx.db.dateState.player.delete(ctx.sender);
    }

    ctx.db.gameSession.insert({
      player: ctx.sender,
      dateId,
      startedAt: ctx.timestamp,
      spaceId: undefined,
    });
    ctx.db.dateState.insert({
      player: ctx.sender,
      phase: 'texting',
      demand: undefined,
      demandMet: false,
    });
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
