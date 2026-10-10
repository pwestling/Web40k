import { defineConfig } from "vite";
import { build } from "./vite.config.ts";

/**
 * The host server's game code for Node (server/host.mjs): the session, the
 * engine and the built-in games, in one file at dist-host/rooms.mjs.
 *   pnpm build:host
 */
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(build()) },
  publicDir: false,
  build: {
    outDir: "dist-host",
    emptyOutDir: true,
    ssr: "src/hostServer/index.ts",
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "rooms.mjs" } },
  },
  ssr: { noExternal: true, target: "node" },
});
