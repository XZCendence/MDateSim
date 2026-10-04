import { DbConnection } from "./module_bindings/index";

const HOST = process.env.SPACETIMEDB_HOST ?? "ws://localhost:3000";
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? "m-date-sim";

/**
 * Opens a SpacetimeDB connection, subscribes to every table, and resolves
 * once the initial snapshot has been applied so `conn.db.*` reads are valid.
 */
export function connectSpacetime(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB_NAME)
      .onConnect((conn, identity) => {
        console.log(`[spacetime] connected to ${DB_NAME} as ${identity.toHexString().slice(0, 12)}…`);
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
          .subscribeToAllTables();
      })
      .onConnectError((_ctx, err) => reject(err))
      .onDisconnect((_ctx, err) => {
        if (err) console.error("[spacetime] disconnected:", err);
      })
      .build();
  });
}
