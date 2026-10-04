import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const bindings = fileURLToPath(
  new URL("../Server/src/module_bindings", import.meta.url),
);
const moduleSrc = fileURLToPath(
  new URL("../Server/spacetimedb/src", import.meta.url),
);
const serverDir = fileURLToPath(new URL("../Server", import.meta.url));

/** Starts Server `users` so `/api` works from `bun run dev` without a separate `imessage`. */
function usersApiPlugin(): Plugin {
  let child: ChildProcess | undefined;

  const start = () => {
    if (child) return;
    child = spawn("bun", ["src/users.ts"], {
      cwd: serverDir,
      stdio: "inherit",
    });
    child.on("exit", () => {
      child = undefined;
    });
  };

  const stop = () => {
    if (!child) return;
    child.kill();
    child = undefined;
  };

  return {
    name: "users-api",
    configureServer(server) {
      start();
      const http = server.httpServer;
      http?.once("listening", start);
      http?.once("close", stop);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), usersApiPlugin()],
  resolve: {
    // Single source of truth: the generated SpacetimeDB bindings live in Server/.
    alias: { "@bindings": bindings },
    // The bindings import `spacetimedb` from Server/node_modules; force one copy.
    dedupe: ["spacetimedb"],
  },
  server: {
    fs: { allow: [".", bindings, moduleSrc] },
    // Under WSL on a Windows drive (/mnt/c) file-change events never fire, so the dev server
    // would keep serving stale code. Polling makes hot reload work there; harmless elsewhere.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
