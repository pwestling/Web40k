/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { execFile, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { build as viteBuild, defineConfig, type Plugin, type Rollup } from "vite";
import pkg from "./package.json" with { type: "json" };

// The app build peers compare in game/packages: version + commit.
export function build(): string {
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

/**
 * `viewer.html`, the replay page (#46): the replay viewer (src/viewer/main.tsx)
 * built into one self-contained HTML file. All of its code is one gzipped,
 * base64'd script that a few lines unpack and run, and its styles and images
 * are inline, so the page opens from a disk with no server. Share the battle
 * fetches it and puts the replay where `<!--REPLAY-->` is (src/share/page.ts).
 * Built after the app; in development, built on first request.
 */
function replayViewer(): Plugin {
  let building: Promise<string> | null = null;
  const make = async (): Promise<string> => {
    const out = (await viteBuild({
      configFile: false,
      logLevel: "warn",
      base: "./",
      mode: "production",
      define: {
        __APP_BUILD__: JSON.stringify(build()),
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [react(), bundledWorker("virtual:sandbox-worker", "src/sandbox/worker.ts")],
      build: {
        write: false,
        minify: true,
        cssCodeSplit: false,
        modulePreload: false,
        // Everything inline: there is no server to fetch from.
        assetsInlineLimit: () => true,
        chunkSizeWarningLimit: 100_000,
        rollupOptions: { input: "viewer.html", output: { codeSplitting: false } as Rollup.OutputOptions },
      },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[];
    const output = (Array.isArray(out) ? out[0]! : out).output;
    const js = output.find((o): o is Rollup.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
    const css = output
      .filter((o): o is Rollup.OutputAsset => o.type === "asset" && o.fileName.endsWith(".css"))
      .map((o) => String(o.source))
      .join("\n");
    const app = gzipSync(Buffer.from(js), { level: 9 }).toString("base64");
    const loader = `(async()=>{const b=atob(document.getElementById("open-battle-app").textContent.trim());const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);const code=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();const s=document.createElement("script");s.type="module";s.textContent=code;document.body.append(s)})().catch(e=>{document.getElementById("root").textContent="This browser can't open the replay: "+e})`;
    return [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '<meta name="theme-color" content="#111827" />',
      "<title>Open Battle replay</title>",
      `<style>${css.replaceAll("</style", "<\\/style")}</style></head><body>`,
      '<div id="root"><p style="font:16px system-ui;color:#ccc;padding:2em">Loading the replay…</p></div>',
      '<script id="open-battle-replay" type="application/octet-stream"><!--REPLAY--></script>',
      `<script id="open-battle-app" type="application/octet-stream">${app}</script>`,
      `<script>${loader}</script>`,
      "</body></html>",
    ].join("\n");
  };
  let outDir = "dist";
  return {
    name: "replay-viewer",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/viewer.html") return next();
        // A production build of its own, in another process: React's plugin picks its JSX from
        // NODE_ENV, which is "development" in this one.
        building ??= new Promise<string>((resolve, reject) => {
          const dir = "node_modules/.viewer";
          execFile(
            "npx",
            ["vite", "build", "--logLevel", "error", "--outDir", dir],
            { env: { ...process.env, NODE_ENV: "production" } },
            (e) => (e ? reject(e) : resolve(readFileSync(join(dir, "viewer.html"), "utf8"))),
          );
        });
        building.then(
          (html) => {
            res.setHeader("content-type", "text/html");
            res.end(html);
          },
          (e: unknown) => {
            building = null;
            next(e);
          },
        );
      });
    },
    async closeBundle() {
      if (process.env.VITEST) return;
      writeFileSync(join(outDir, "viewer.html"), await make());
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
    replayViewer(),
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
    include: process.env.BOT
      ? ["src/bot/*.match.test.ts"]
      : process.env.SOAK
        ? ["src/soak/*.soak.test.ts"]
        : ["src/**/*.test.ts", "server/**/*.test.ts"],
    exclude:
      process.env.SOAK || process.env.BOT
        ? ["**/node_modules/**"]
        : ["**/node_modules/**", "src/**/*.soak.test.ts", "src/**/*.match.test.ts"],
  },
});
