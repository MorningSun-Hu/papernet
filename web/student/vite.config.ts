import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".monkeycode-ai.online"],
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": { target: "http://127.0.0.1:8080", changeOrigin: true },
      "/ws": { target: "http://127.0.0.1:8080", changeOrigin: true, ws: true },
    },
  },
  resolve: {
    alias: {
      "@icons": path.join(repoRoot, "assets/icons"),
      "@shared": path.join(repoRoot, "web/shared"),
    },
  },
});
