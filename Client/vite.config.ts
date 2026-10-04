import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const bindings = fileURLToPath(
  new URL("../Server/src/module_bindings", import.meta.url),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Single source of truth: the generated SpacetimeDB bindings live in Server/.
    alias: { "@bindings": bindings },
  },
  server: {
    fs: { allow: [".", bindings] },
  },
});
