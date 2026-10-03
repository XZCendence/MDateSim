import { schema, table, t } from 'spacetimedb/server';

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema({ player });
export default spacetimedb;

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
