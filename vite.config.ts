/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
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
 * `virtual:sdk-types`: what the module workshop's type checker (#43) reads,
 * keyed by path: the declarations of the SDK and everything it names,
 * emitted from src/sdk/index.ts and the package manifest, and the ES lib
 * files (a package runs in a worker: no DOM).
 */
function sdkTypes(): Plugin {
  const id = "virtual:sdk-types";
  return {
    name: "sdk-types",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    load(s) {
      if (s !== `\0${id}`) return null;
      const files: Record<string, string> = {};
      const root = process.cwd();
      const program = ts.createProgram(
        [join(root, "src/sdk/index.ts"), join(root, "src/packages/manifest.ts")],
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          declaration: true,
          emitDeclarationOnly: true,
          skipLibCheck: true,
          strict: true,
          types: ["vite/client"],
          lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
        },
      );
      program.emit(undefined, (name, text) => {
        const rel = relative(root, name).replaceAll("\\", "/");
        if (rel.startsWith("..")) return;
        files[`/${rel}`] = text;
        // A change to the SDK, or anything it names, makes new declarations.
        this.addWatchFile(join(root, rel.replace(/\.d\.ts$/, ".ts")));
      });
      const lib = dirname(ts.getDefaultLibFilePath({}));
      for (const f of readdirSync(lib))
        if (/^lib\.(es5|es20\d\d|decorators)[\w.]*\.d\.ts$/.test(f) && !f.includes(".full."))
          files[`/lib/${f}`] = readFileSync(join(lib, f), "utf8");
      return `export default ${JSON.stringify(files)};`;
    },
  };
}

/**
 * `virtual:sandbox-worker`: the rules-package sandbox's worker (the engine and
 * the built-in systems, src/sandbox/worker.ts) bundled into one script and
 * handed to the app as text. The app starts it from a blob inside a sandboxed
 * iframe, which can't load scripts from the app's origin. UI files (.tsx) are
 * stubbed: the worker never renders. `virtual:soak-worker` is the module
 * workshop's soak bot (src/workshop/soakWorker.ts), started the same way.
 */
function bundledWorker(id: string, entry: string): Plugin {
  let cached: { code: string; files: string[] } | null = null;
  return {
    name: id.replace("virtual:", ""),
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
            lib: { entry, formats: ["iife"], name: "sandbox", fileName: "worker" },
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

/** Every file under a folder, as paths relative to it. */
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesIn(path).map((f) => relative(dir, join(path, f))) : [name];
    });
  } catch {
    return [];
  }
}

/**
 * `sw.js`, the service worker (src/sw/sw.template.js), with the build's files
 * to keep on the device and a version that changes with them, so browsers
 * notice a new build. In development it keeps nothing, for play-by-mail push
 * only.
 */
function serviceWorker(): Plugin {
  const template = () => readFileSync("src/sw/sw.template.js", "utf8");
  const fill = (files: string[], version: string) =>
    template().replace("__VERSION__", version).replace("__FILES__", JSON.stringify(files));
  return {
    name: "service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/sw.js") return next();
        res.setHeader("content-type", "text/javascript");
        res.end(fill([], "dev"));
      });
    },
    generateBundle(_, bundle) {
      // index.html joins the bundle after this runs; the version still follows it, through the hashed
      // file names it points at.
      const files = [...new Set([...Object.keys(bundle), ...filesIn("public"), "index.html"])]
        .filter((f) => !f.endsWith(".map"))
        // The workshop's type checker is TypeScript itself: fetched when the workshop opens, not kept for play.
        .filter((f) => !/typesWorker-[\w-]+\.js$/.test(f))
        .sort();
      // The version follows the files' contents, so any change to the build makes a new one.
      const hash = createHash("sha256");
      for (const f of files) {
        const out = bundle[f];
        hash.update(f);
        if (out) hash.update(out.type === "chunk" ? out.code : out.source);
        else if (f !== "index.html") hash.update(readFileSync(join("public", f)));
      }
      const version = hash.digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: fill(files, version) });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    bundledWorker("virtual:sandbox-worker", "src/sandbox/worker.ts"),
    bundledWorker("virtual:soak-worker", "src/workshop/soakWorker.ts"),
    sdkTypes(),
    serviceWorker(),
  ],
  define: { __APP_BUILD__: JSON.stringify(build()) },
  // The workshop's type checker (#43) is a module worker with TypeScript and the SDK's declarations in it.
  worker: { format: "es", plugins: () => [sdkTypes()] },
  // Relative asset paths so the build can be hosted under any sub-path
  // (e.g. GitHub Pages at /open-battle/).
  base: "./",
  // three.js alone is ~700 kB; split chunks once there is more than one screen.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    // The soak games (src/soak) run on their own, in CI's soak job: `pnpm soak`.
    include: process.env.SOAK ? ["src/soak/*.soak.test.ts"] : ["src/**/*.test.ts", "server/**/*.test.ts"],
    exclude: process.env.SOAK ? ["**/node_modules/**"] : ["**/node_modules/**", "src/**/*.soak.test.ts"],
  },
});
