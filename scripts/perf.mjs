// Rendering benchmark: deploys sample armies, dresses every profile in a
// synthetic high-poly sculpt and reports frame times and GPU load.
//
//   pnpm perf                  # default scenarios
//   pnpm perf -- --gpu         # use the machine's GPU instead of SwiftShader
//   pnpm perf -- --only Conquest  # just the scenarios whose name contains this
//   CHROMIUM=/path/to/chrome pnpm perf
//
// Frame times under SwiftShader (software GL, the default so it runs
// anywhere) are CPU-bound and much slower than a real GPU: compare runs
// against each other, not against the budget. Triangle and draw-call counts
// are exact either way. Results: /mnt/project-files/perf/ when run by Claude.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 5199;
const gpu = process.argv.includes("--gpu");
// --only <text>: run just the scenarios whose name contains it.
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

// Its own process group, so stopping it also stops the vite process npx starts.
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("localhost") && resolve());
  server.on("exit", reject);
});

const browser = await chromium.launch({
  executablePath,
  args: gpu ? ["--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-gl=angle", "--use-angle=swiftshader"],
});
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.setDefaultTimeout(0);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.openBattlePerf);
  const models = await page.evaluate(() => window.openBattlePerf.setup(3));
  const run = async (name, fn, frames = 60, warmup = 10) => {
    if (only && !name.includes(only)) return;
    const prep = await page.evaluate(fn);
    const m = await page.evaluate(([n, w]) => window.openBattlePerf.measure(n, w), [frames, warmup]);
    results.push({ scenario: name, ...m, ...(prep && typeof prep === "object" ? prep : {}) });
    console.error(name, JSON.stringify(results.at(-1)));
  };
  await run("stand-ins", () => window.openBattlePerf.undress());
  // The same table while 60 dice tumble across the tray (DOM animation over the canvas).
  await run("stand-ins, 60 dice rolling", () => window.openBattlePerf.roll(60), 30, 0);
  await run("pipeline, 100k sculpts", () => window.openBattlePerf.dress(100_000));
  await run("pipeline, 1M sculpts", () => window.openBattlePerf.dress(1_000_000));
  // A painted army: 1M-triangle sculpts with a 2048 px texture each, baked and compressed like an upload.
  await run("painted, 1M sculpts + 2K textures", () => window.openBattlePerf.dress(1_000_000, false, true));
  if (process.env.PAINT_SCREENSHOT && (!only || "painted, 1M sculpts + 2K textures".includes(only)))
    await page.screenshot({ path: process.env.PAINT_SCREENSHOT });
  // Photo standees (#68): 24 distinct cut-out cards (the budget's most before textures drop a size) round the table.
  await run("standees, 24 distinct", () => window.openBattlePerf.standees(24));
  if (process.env.STANDEE_SCREENSHOT && (!only || "standees, 24 distinct".includes(only)))
    await page.screenshot({ path: process.env.STANDEE_SCREENSHOT });
  // Every terrain piece an uploaded model (three distinct 500k-triangle sculpts), figures on.
  await run("terrain-heavy: uploaded terrain + 1M figures", () => window.openBattlePerf.terrain(500_000));
  if (process.env.PERF_SCREENSHOT) await page.screenshot({ path: process.env.PERF_SCREENSHOT });
  // Full detail is slow enough under SwiftShader that a few frames will do.
  await run("no pipeline, 100k sculpts", () => window.openBattlePerf.dress(100_000, true), 3, 1);
  // A big rank-and-flank game: about 200 models in blocks (The Old World style).
  await run("Old World, ~200 models, stand-ins", async () => {
    const perArmyPair = await window.openBattlePerf.setup(1, "tow-hand");
    const models = await window.openBattlePerf.setup(Math.ceil(200 / perArmyPair), "tow-hand");
    return { models };
  });
  // The rules sandbox on that Old World table, against perf/scripting-budget.md (no frames: call timings).
  if (!only || "rules sandbox".includes(only)) {
    if (only) await page.evaluate(() => window.openBattlePerf.setup(4, "tow-hand"));
    results.push({
      scenario: "rules sandbox",
      ...(await page.evaluate(() => window.openBattlePerf.sandbox())),
    });
    console.error(JSON.stringify(results.at(-1)));
  }
  // Conquest: regiments of stands, 20 a side, on the table (before reinforcements).
  await run("Conquest, 40 regiments (148 stands)", async () => {
    const models = await window.openBattlePerf.setup(4, "conquest-hand");
    return { models, dispatch: await window.openBattlePerf.dispatchCost() };
  });
  console.log(JSON.stringify({ when: new Date().toISOString(), gpu, models, results }, null, 2));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
