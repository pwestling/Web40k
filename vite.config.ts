/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { build as viteBuild, defineConfig, type Plugin, type Rollup } from "vite";
import pkg from "./package.json" with { type: "json" };

// The app build peers compare in game/packages: version + commit.
function build(): string {
  try {
    return `${pkg.version}+${execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()}`;
  } catch {
    return `${pkg.version}+dev`;
  }
}

/**
 * `virtual:sandbox-worker`: the rules-package sandbox's worker (the engine and
 * the built-in systems, src/sandbox/worker.ts) bundled into one ES module and
 * handed to the app as text. The app starts it from a blob inside a sandboxed
 * iframe, which can't load scripts from the app's origin. UI files (.tsx) are
 * stubbed: the worker never renders.
 */
function sandboxWorker(): Plugin {
  const id = "virtual:sandbox-worker";
  let cached: { code: string; files: string[] } | null = null;
  return {
    name: "sandbox-worker",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    async load(s) {
      if (s !== `\0${id}`) return null;
      if (!cached) {
        const out = (await viteBuild({
          configFile: false,
          logLevel: "warn",
          define: {
            __APP_BUILD__: JSON.stringify(build()),
            "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
          },
          plugins: [
            {
              name: "stub-ui",
              load(file) {
                if (!file.endsWith(".tsx")) return null;
                const names = [
                  ...readFileSync(file, "utf8").matchAll(/export\s+(?:function|const|class)\s+(\w+)/g),
                ].map((m) => m[1]);
                return names.map((n) => `export const ${n} = () => null;`).join("\n") || "export {};";
              },
            },
          ],
          build: {
            write: false,
            minify: process.env.NODE_ENV === "production",
            // A classic worker: a module worker can't start from a blob in an opaque origin.
            lib: { entry: "src/sandbox/worker.ts", formats: ["iife"], name: "sandbox", fileName: "worker" },
          },
        })) as Rollup.RollupOutput | Rollup.RollupOutput[];
        const output = (Array.isArray(out) ? out[0]! : out).output;
        const chunk = output.find((o): o is Rollup.OutputChunk => o.type === "chunk")!;
        cached = { code: chunk.code, files: Object.keys(chunk.modules) };
      }
      for (const f of cached.files) if (!f.startsWith("\0")) this.addWatchFile(f);
      return `export default ${JSON.stringify(cached.code)};`;
    },
    watchChange(file) {
      if (cached?.files.includes(file)) cached = null;
    },
    handleHotUpdate({ file, server }) {
      if (!cached?.files.includes(file)) return;
      cached = null;
      const mod = server.moduleGraph.getModuleById(`\0${id}`);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

export default defineConfig({
  plugins: [react(), sandboxWorker()],
  define: { __APP_BUILD__: JSON.stringify(build()) },
  // Relative asset paths so the build can be hosted under any sub-path
  // (e.g. GitHub Pages at /open-battle/).
  base: "./",
  // three.js alone is ~700 kB; split chunks once there is more than one screen.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
