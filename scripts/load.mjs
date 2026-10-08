// Landing-page load benchmark: builds the app, serves the production build
// and loads the front door cold, on a throttled connection, a few times.
//
//   pnpm perf:load            # 10 Mbit/s, 40 ms round trip, CPU as is
//   pnpm perf:load -- --cpu 4 # slow the CPU 4x (a weak laptop)
//
// Reports what the first screen downloads (JS gzip), first contentful paint,
// when the lobby can be clicked, main-thread blocking, and when the 3D table
// has loaded behind it. Budgets: /mnt/project-files/perf/budget.md.
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 5197;
const arg = (name, fallback) =>
  process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback;
const cpu = arg("--cpu", 1);
const runs = arg("--runs", 3);
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

if (!process.argv.includes("--no-build"))
  execSync("npx vite build", { stdio: "ignore", env: { ...process.env, NODE_ENV: "production" } });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("localhost") && resolve());
  server.on("exit", reject);
});
const browser = await chromium.launch({
  executablePath,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const results = [];
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
    });
    if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const js = [];
    cdp.on("Network.loadingFinished", (e) => js.push(e));
    const types = new Map();
    cdp.on("Network.responseReceived", (e) => types.set(e.requestId, { url: e.response.url, type: e.type }));
    await page.addInitScript(() => {
      window.__lt = [];
      new PerformanceObserver((l) =>
        l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration])),
      ).observe({
        type: "longtask",
        buffered: true,
      });
    });
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "commit" });
    // The lobby's buttons are on screen and enabled.
    await page.waitForSelector(".lobby button:not([disabled])", { state: "visible" });
    const lobbyMs = Date.now() - t0;
    const firstScreen = js.reduce(
      (n, e) => n + (types.get(e.requestId)?.type === "Script" ? e.encodedDataLength : 0),
      0,
    );
    // The 3D table behind it.
    await page.waitForSelector("canvas", { timeout: 60_000 }).catch(() => null);
    const tableMs = Date.now() - t0;
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      const tbt = window.__lt
        .filter(([s]) => s < (fcp ?? 0) + 5000)
        .reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
      return {
        fcp: fcp && Math.round(fcp),
        tbt: Math.round(tbt),
        longest: Math.round(Math.max(0, ...window.__lt.map(([, d]) => d))),
      };
    });
    const allJs = js.reduce(
      (n, e) => n + (types.get(e.requestId)?.type === "Script" ? e.encodedDataLength : 0),
      0,
    );
    results.push({
      lobbyMs,
      fcpMs: m.fcp,
      tableMs,
      tbtMs: m.tbt,
      longestTaskMs: m.longest,
      firstScreenJsKB: Math.round(firstScreen / 1024),
      allJsKB: Math.round(allJs / 1024),
    });
    console.error(JSON.stringify(results.at(-1)));
    await context.close();
  }
  const med = (k) => [...results.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(results.length / 2)];
  console.log(
    JSON.stringify(
      {
        when: new Date().toISOString(),
        cpu,
        runs,
        median: Object.fromEntries(Object.keys(results[0]).map((k) => [k, med(k)])),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  process.kill(-server.pid);
}
