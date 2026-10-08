// The table companion (#37) on a mid-range phone: a production build, a
// phone's screen and touch, 4G (9 Mbit/s, 85 ms) and a CPU slowed 4x. Times
// a cold visit to the lobby, "One phone for both of us" to the companion,
// a sample army to its first unit tile and card, and what each roll costs
// on the main thread. Results: /mnt/project-files/perf/results.md.
//
//   pnpm perf:phone              # builds, then three runs
//   pnpm perf:phone -- --no-build --runs 1 --cpu 6
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const runs = Number(arg("--runs", 3));
const cpu = Number(arg("--cpu", 4));
const rolls = Number(arg("--rolls", 5));
const PORT = 5195;
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

if (!process.argv.includes("--no-build")) execSync("npx vite build --logLevel error", { stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("localhost") && resolve());
  server.on("exit", reject);
});
const browser = await chromium.launch({ executablePath });
const results = [];
try {
  for (let r = 0; r < runs; r++) {
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 85,
      downloadThroughput: (9 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const scripts = [];
    const urls = new Map();
    cdp.on("Network.responseReceived", (e) => e.type === "Script" && urls.set(e.requestId, e.response.url));
    cdp.on("Network.loadingFinished", (e) => {
      if (urls.has(e.requestId)) scripts.push({ url: urls.get(e.requestId), kb: e.encodedDataLength / 1024 });
    });
    await page.addInitScript(() => {
      window.__lt = [];
      new PerformanceObserver((l) =>
        l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration])),
      ).observe({ type: "longtask", buffered: true });
    });
    const blocking = (from, to) =>
      page.evaluate(
        ([a, b]) =>
          window.__lt.filter(([s]) => s >= a && s < b).reduce((n, [, d]) => n + Math.max(0, d - 50), 0),
        [from, to],
      );
    const now = () => page.evaluate(() => performance.now());
    const kb = () => Math.round(scripts.reduce((n, s) => n + s.kb, 0));

    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "commit" });
    await page.getByRole("button", { name: "One phone for both of us" }).waitFor();
    const lobbyMs = Date.now() - t0;

    let t = Date.now();
    await page.getByRole("button", { name: "One phone for both of us" }).tap();
    await page.locator(".companion").waitFor();
    const companionMs = Date.now() - t;
    const companionKB = kb();
    const threeLoaded = scripts.some((s) => /Miniatures|Board/.test(s.url));

    t = Date.now();
    await page.getByRole("button", { name: "Sample army" }).first().tap();
    await page
      .getByRole("button", { name: /^Deploy for / })
      .first()
      .tap();
    await page.locator(".companion-units .tile").first().waitFor();
    const firstTileMs = Date.now() - t;
    t = Date.now();
    await page.locator(".companion-units .tile").first().tap();
    await page.locator(".panel.unitcard").waitFor();
    const cardMs = Date.now() - t;
    await page.getByRole("button", { name: "← All units" }).tap();

    // Rolls: ten dice from the Game tab, each until the tray shows them and the main thread is free.
    await page.getByRole("tab", { name: "Game" }).tap();
    await page.getByLabel("Number of dice").fill("10");
    const roll = [];
    for (let i = 0; i < rolls; i++) {
      const a = await now();
      const start = Date.now();
      await page.getByRole("button", { name: "Roll", exact: true }).tap();
      await page.locator(".dice-tray.on").waitFor();
      const shownMs = Date.now() - start;
      await page.waitForTimeout(2500);
      roll.push({ shownMs, blockingMs: Math.round(await blocking(a, await now())) });
      await page.waitForTimeout(500);
    }
    const row = {
      lobbyMs,
      companionMs,
      companionKB,
      threeLoaded,
      firstTileMs,
      cardMs,
      rollShownMs: Math.round(roll.reduce((n, x) => n + x.shownMs, 0) / roll.length),
      rollBlockingMs: Math.round(roll.reduce((n, x) => n + x.blockingMs, 0) / roll.length),
      allJsKB: kb(),
    };
    results.push(row);
    console.error(JSON.stringify(row));
    await context.close();
  }
  const med = (k) => [...results.map((x) => x[k])].sort((a, b) => a - b)[Math.floor(results.length / 2)];
  const keys = Object.keys(results[0]).filter((k) => typeof results[0][k] === "number");
  console.log(
    JSON.stringify(
      {
        when: new Date().toISOString(),
        cpu,
        median: Object.fromEntries(keys.map((k) => [k, med(k)])),
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
