import { DbConnection } from "@bindings/index";

/**
 * Connection builder handed to <SpacetimeDBProvider> in main.tsx.
 * Bindings are generated into Server/src/module_bindings and aliased as `@bindings`;
 * re-run `bun run spacetime:generate` in Server/ after changing the module schema.
 *
 * The browser's SpacetimeDB identity *is* the player (see the module's clientConnected
 * hook), so the token is persisted to keep the same identity across reloads.
 */
const TOKEN_KEY = "mdatesim.spacetime.token";

function loadToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const connectionBuilder = DbConnection.builder()
  .withUri(import.meta.env.VITE_SPACETIMEDB_HOST)
  .withDatabaseName(import.meta.env.VITE_SPACETIMEDB_DB_NAME)
  .withToken(loadToken())
  .onConnect((_c, identity, token) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
    console.info("[spacetime] connected as", identity.toHexString().slice(0, 12));
  })
  .onConnectError((_c, err) => console.error("[spacetime] connect error", err));
