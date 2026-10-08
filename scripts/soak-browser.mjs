// Long-session memory and leak check: the soak bot plays game after game in
// the real app (dev build, SwiftShader), with painted figures, the dice tray,
// sound and ambience, and a rules package in the sandbox. Every few minutes
// it forces a GC and samples the JS heap, DOM nodes, listeners, frames and
// what the renderer holds. Results: /mnt/project-files/perf/results.md.
//
//   pnpm soak:browser -- --minutes 180 --sample 5 --out soak.jsonl
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const minutes = Number(arg("--minutes", 180));
const sampleMin = Number(arg("--sample", 5));
const everyMs = Number(arg("--every", 300));
const out = arg("--out", "soak-browser.jsonl");
const PORT = 5196;
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

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
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
writeFileSync(out, "");
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
  page.setDefaultTimeout(0);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.openBattleSoak && window.openBattlePerf);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate((ms) => window.openBattleSoak.start(ms), everyMs);
  const t0 = Date.now();
  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const m = Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]),
    );
    const app = await page.evaluate(() => ({
      ...window.openBattleSoak.stats(),
      gpu: window.openBattlePerf.gpu(),
    }));
    const row = {
      min: Math.round((Date.now() - t0) / 60000),
      heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1),
      totalHeapMB: +(m.JSHeapTotalSize / 1e6).toFixed(1),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      frames: m.Frames,
      ...app,
      pageErrors: errors.length,
    };
    appendFileSync(out, JSON.stringify(row) + "\n");
    console.error(JSON.stringify(row));
  };
  await sample();
  while (Date.now() - t0 < minutes * 60000) {
    await new Promise((r) => setTimeout(r, sampleMin * 60000));
    await sample();
  }
  await page.evaluate(() => window.openBattleSoak.stop());
  if (errors.length)
    appendFileSync(out, JSON.stringify({ pageErrors: [...new Set(errors)].slice(0, 20) }) + "\n");
} finally {
  await browser.close();
  process.kill(-server.pid);
}
