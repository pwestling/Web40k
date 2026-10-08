// Rift Lanterns "Play now" from a cold start on a mid-range phone profile
// (412x915 touch, 4G at 9 Mbit/s and 85 ms, CPU slowed 4x; production build).
// Times the lobby, Play now to the table, the army showcase and a playable
// table, and counts what the GPU is asked to draw (draw calls and triangles
// per frame, from wrapped WebGL calls) and the frame times during the
// showcase and after it. Software GL (SwiftShader) makes frame times
// CPU-bound: compare runs, not devices. Results: /mnt/project-files/perf/results.md.
//
//   pnpm perf:rift                       # builds, then three runs
//   pnpm perf:rift -- --no-build --runs 1 --cpu 1
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const runs = Number(arg("--runs", 3));
const cpu = Number(arg("--cpu", 4));
const PORT = 5193;
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

/** In the page: frame times, and per frame the draw calls and triangles WebGL was asked for. */
function instrument() {
  const frames = (window.__frames = []);
  let calls = 0;
  let tris = 0;
  const wrap = (proto, name, count, instances) => {
    const f = proto[name];
    if (!f) return;
    proto[name] = function (...a) {
      calls++;
      const mode = a[0];
      const n = a[count] * (instances === undefined ? 1 : a[instances]);
      tris += mode === 4 ? n / 3 : 0;
      return f.apply(this, a);
    };
  };
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    wrap(P, "drawElements", 1);
    wrap(P, "drawArrays", 2);
    wrap(P, "drawElementsInstanced", 1, 4);
    wrap(P, "drawArraysInstanced", 2, 3);
  }
  let last = performance.now();
  const tick = (now) => {
    if (calls)
      frames.push({
        t: now,
        dt: now - last,
        calls,
        tris,
        showcase: document.body.classList.contains("showcase"),
      });
    calls = 0;
    tris = 0;
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__lt = [];
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration])),
  ).observe({ type: "longtask", buffered: true });
}

const browser = await chromium.launch({
  executablePath,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const results = [];
try {
  for (let r = 0; r < runs; r++) {
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 85,
      downloadThroughput: (9 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
    });
    if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.addInitScript(instrument);

    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "commit" });
    const play = page.getByRole("button", { name: "Play now (both sides)" });
    await play.waitFor();
    const lobbyMs = Date.now() - t0;
    const tap = await page.evaluate(() => performance.now());
    const t1 = Date.now();
    await play.tap();
    await page.locator("body.showcase").waitFor({ timeout: 120_000 });
    const showcaseStartMs = Date.now() - t1;
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, {
      timeout: 120_000,
      polling: 100,
    });
    const playableMs = Date.now() - t1;
    await page.waitForTimeout(3000);
    const m = await page.evaluate((from) => {
      const pct = (xs, p) => {
        const s = [...xs].sort((a, b) => a - b);
        return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 : null;
      };
      const show = window.__frames.filter((f) => f.showcase);
      const after = window.__frames.filter((f) => !f.showcase && f.t > (show.at(-1)?.t ?? from));
      const blocking = window.__lt
        .filter(([s]) => s >= from)
        .reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
      return {
        showcaseFrameP50: pct(
          show.map((f) => f.dt),
          0.5,
        ),
        showcaseFrameP95: pct(
          show.map((f) => f.dt),
          0.95,
        ),
        idleFrameP50: pct(
          after.map((f) => f.dt),
          0.5,
        ),
        drawCalls: pct(
          after.map((f) => f.calls),
          0.5,
        ),
        triangles: pct(
          after.map((f) => f.tris),
          0.5,
        ),
        blockingAfterTapMs: Math.round(blocking),
        longestTaskMs: Math.round(Math.max(0, ...window.__lt.filter(([s]) => s >= from).map(([, d]) => d))),
      };
    }, tap);
    const row = { lobbyMs, showcaseStartMs, playableMs, ...m };
    results.push(row);
    console.error(JSON.stringify(row));
    await context.close();
  }
  const med = (k) => [...results.map((x) => x[k])].sort((a, b) => a - b)[Math.floor(results.length / 2)];
  console.log(
    JSON.stringify(
      {
        when: new Date().toISOString(),
        cpu,
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
