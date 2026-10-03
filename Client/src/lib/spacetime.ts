import { DbConnection } from "@bindings/index";

/**
 * Lazily opens one shared SpacetimeDB connection for the whole app.
 * Bindings are generated into Server/src/module_bindings and aliased as `@bindings`;
 * re-run `bun run spacetime:generate` in Server/ after changing the module schema.
 */
let conn: DbConnection | undefined;

export function getSpacetime(): DbConnection {
  if (conn) return conn;
  conn = DbConnection.builder()
    .withUri(import.meta.env.VITE_SPACETIMEDB_HOST)
    .withDatabaseName(import.meta.env.VITE_SPACETIMEDB_DB_NAME)
    .onConnect((_c, identity) => {
      console.info("[spacetime] connected as", identity.toHexString().slice(0, 16));
    })
    .onConnectError((_c, err) => console.error("[spacetime] connect error", err))
    .build();
  return conn;
}
