// Rendering benchmark: deploys sample armies, dresses every profile in a
// synthetic high-poly sculpt and reports frame times and GPU load.
//
//   pnpm perf                  # default scenarios
//   pnpm perf -- --gpu         # use the machine's GPU instead of SwiftShader
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
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("Local") && resolve());
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
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.openBattlePerf);
  const models = await page.evaluate(() => window.openBattlePerf.setup(3));
  const run = async (name, fn) => {
    const prep = await page.evaluate(fn);
    const m = await page.evaluate(() => window.openBattlePerf.measure(90));
    results.push({ scenario: name, ...m, ...(prep && typeof prep === "object" ? prep : {}) });
    console.error(name, JSON.stringify(results.at(-1)));
  };
  await run("stand-ins", () => window.openBattlePerf.undress());
  await run("raw 250k sculpts", () => window.openBattlePerf.dress(250_000, true));
  await run("pipeline, 250k sculpts", () => window.openBattlePerf.dress(250_000));
  await run("pipeline, 2M sculpts", () => window.openBattlePerf.dress(2_000_000));
  await page.screenshot({ path: process.env.PERF_SCREENSHOT ?? "perf.png" });
  console.log(JSON.stringify({ when: new Date().toISOString(), gpu, models, results }, null, 2));
} finally {
  await browser.close();
  server.kill();
}
