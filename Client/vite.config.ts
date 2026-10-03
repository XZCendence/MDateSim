import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const bindings = fileURLToPath(
  new URL("../Server/src/module_bindings", import.meta.url),
);
const moduleSrc = fileURLToPath(
  new URL("../Server/spacetimedb/src", import.meta.url),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Single source of truth: the generated SpacetimeDB bindings live in Server/.
    alias: { "@bindings": bindings },
    // The bindings import `spacetimedb` from Server/node_modules; force one copy.
    dedupe: ["spacetimedb"],
  },
  server: {
    fs: { allow: [".", bindings, moduleSrc] },
  },
});
