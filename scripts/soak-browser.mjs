// Long-session memory and leak check: the soak bot plays game after game in
// the real app (a development build, SwiftShader), as two tabs in an online game over a
// local relay: WebRTC, figure sharing and voice (fake mic), painted figures,
// the dice tray, sound and ambience, and a rules package in the sandbox.
// Every few minutes it forces a GC in each tab and samples the JS heap, DOM
// nodes, listeners, frames and what the renderer holds. Results:
// /mnt/project-files/perf/results.md.
//
// Chess clocks run in every game, and the host annotates each finished game's replay.
//
//   pnpm soak:browser -- --minutes 180 --sample 5 --out soak.jsonl [--dev-server]
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const minutes = Number(arg("--minutes", 180));
const sampleMin = Number(arg("--sample", 5));
const everyMs = Number(arg("--every", 300));
const out = arg("--out", "soak-browser.jsonl");
const PORT = 5196;
const RELAY = 8797;
const SYSTEMS = arg("--systems", "forty-k-11,tow-hand,conquest-hand,fsd").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end)
    if (await fn()) return true;
    else await sleep(500);
  return false;
};
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

// A development-mode build (the soak hooks are in, React Refresh and HMR are
// not): the dev server's React Refresh keeps every unmounted React root (each
// unit label is one), which reads as a leak the real app doesn't have.
// --dev-server soaks the dev server instead.
const BUILD = "node_modules/.soak-build";
if (!process.argv.includes("--dev-server"))
  execFileSync("npx", ["vite", "build", "--outDir", BUILD, "--emptyOutDir", "--logLevel", "error"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
const server = spawn(
  "npx",
  process.argv.includes("--dev-server")
    ? ["vite", "--port", String(PORT), "--strictPort"]
    : ["vite", "preview", "--outDir", BUILD, "--port", String(PORT), "--strictPort"],
  { stdio: "pipe", detached: true },
);
const relay = spawn("node", ["server/relay.mjs"], {
  stdio: "pipe",
  detached: true,
  env: { ...process.env, PORT: String(RELAY) },
});
await Promise.all(
  [server, relay].map(
    (p) =>
      new Promise((resolve, reject) => {
        p.stdout.on("data", (d) => String(d).includes("localhost") && resolve());
        p.on("exit", reject);
      }),
  ),
);
const browser = await chromium.launch({
  executablePath,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
writeFileSync(out, "");
const errors = [];
const games = { started: 0, finished: 0, stuck: 0, noSeat: 0 };
try {
  // Separate contexts: each tab its own storage, so its own player.
  const tabs = [];
  for (const name of ["host", "guest"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.grantPermissions(["microphone"]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message.slice(0, 300)}`));
    page.setDefaultTimeout(120_000);
    await page.goto(`http://localhost:${PORT}/?signal=ws://localhost:${RELAY}`);
    await page.waitForFunction(() => window.openBattleSoak && window.openBattlePerf);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    tabs.push({ name, page, cdp });
  }
  const [host, guest] = tabs;
  const t0 = Date.now();
  let nextSample = 0;
  const sample = async () => {
    const row = {
      min: Math.round((Date.now() - t0) / 60000),
      games: { ...games },
      pageErrors: errors.length,
    };
    for (const { name, page, cdp } of tabs) {
      await cdp.send("HeapProfiler.collectGarbage");
      const m = Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]),
      );
      const app = await page.evaluate(() => ({
        ...window.openBattleSoak.stats(),
        gpu: window.openBattlePerf.gpu(),
      }));
      row[name] = {
        heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1),
        totalHeapMB: +(m.JSHeapTotalSize / 1e6).toFixed(1),
        nodes: m.Nodes,
        listeners: m.JSEventListeners,
        documents: m.Documents,
        frames: m.Frames,
        ...app,
      };
    }
    appendFileSync(out, JSON.stringify(row) + "\n");
    console.error(JSON.stringify(row));
  };
  const maybeSample = async () => {
    if (Date.now() < nextSample) return;
    nextSample = Date.now() + sampleMin * 60000;
    await sample();
  };
  const stats = (tab) => tab.page.evaluate(() => window.openBattleSoak.stats());

  for (let n = 0; Date.now() - t0 < minutes * 60000; n++) {
    const system = SYSTEMS[n % SYSTEMS.length];
    const room = `soak-${t0}-${n}`;
    games.started++;
    await host.page.evaluate(([r, s, i]) => window.openBattleSoak.join("host", r, s, i), [room, system, n]);
    await guest.page.evaluate(
      ([r, s, i]) => window.openBattleSoak.join("client", r, s, i),
      [room, system, n],
    );
    const seated = await until(
      async () =>
        (await guest.page.evaluate(() => window.openBattleSoak.seated())) &&
        (await host.page.evaluate(() => window.openBattleSoak.full())),
      90_000,
    );
    if (!seated) {
      games.noSeat++;
      console.error(`game ${n} (${system}): the guest never sat down`);
    } else {
      await host.page.evaluate(() => window.openBattleSoak.deploy());
      await guest.page.evaluate(() => window.openBattleSoak.deploy());
      await host.page.evaluate((ms) => window.openBattleSoak.play(ms), everyMs);
      await guest.page.evaluate((ms) => window.openBattleSoak.play(ms), everyMs);
      for (;;) {
        await sleep(5000);
        await maybeSample();
        const [h, g] = [await stats(host), await stats(guest)];
        if (h.over) {
          games.finished++;
          // The host annotates the game's replay and steps through it before the next one.
          await host.page.evaluate(() => window.openBattleSoak.review());
          break;
        }
        if (Math.min(h.quietMs, g.quietMs) > 90_000) {
          games.stuck++;
          console.error(`game ${n} (${system}): stuck in round ${h.round}`);
          break;
        }
        if (Date.now() - t0 > minutes * 60000) break;
      }
    }
    for (const tab of tabs) await tab.page.evaluate(() => window.openBattleSoak.leave());
    await maybeSample();
  }
  await sample();
  if (errors.length)
    appendFileSync(out, JSON.stringify({ pageErrors: [...new Set(errors)].slice(0, 20) }) + "\n");
} finally {
  await browser.close();
  process.kill(-server.pid);
  process.kill(-relay.pid);
}
