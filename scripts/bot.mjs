// The computer opponent (#45) in the browser: Play the computer (40k, Sharp
// by default) from a production build, on a laptop profile (1600x900, CPU as
// the machine runs) and a mid-range phone profile (412x915 touch, CPU slowed
// 4x). The player's side just moves the phases on, so the computer plays its
// turns against a side that doesn't fight back. Reads each decision from the
// "bot:think" performance measures SoloBot records, times the computer's
// whole turns, and checks frames while it thinks (rAF gaps and long tasks).
// SwiftShader: frame times are CPU-bound, compare runs, not devices.
// Results: /mnt/project-files/perf/results.md.
//
//   pnpm perf:bot                               # builds, laptop and phone, Sharp
//   pnpm perf:bot -- --no-build --profiles phone --level steady --turns 1
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const level = arg("--level", "sharp");
const turns = Number(arg("--turns", 3));
const profiles = arg("--profiles", "laptop,phone").split(",");
// "40k" (the first built-in demo) or "rift" (Rift Lanterns, a package game: the computer thinks in the sandbox).
const game = arg("--game", "40k");
// --on-page: no workers on the page, so the computer thinks on the main thread (as before it had one).
const onPage = process.argv.includes("--on-page");
const PORT = 5197;
const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

const PROFILES = {
  laptop: { cpu: 1, context: { viewport: { width: 1600, height: 900 } } },
  phone: {
    cpu: 4,
    context: {
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    },
  },
};

if (!process.argv.includes("--no-build")) execSync("npx vite build --logLevel error", { stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("localhost") && resolve());
  server.on("exit", reject);
});

/** In the page: every frame's time and whether it is the computer's turn (its side chip, the second, is active). */
function instrument() {
  const frames = (window.__frames = []);
  let last = performance.now();
  const tick = (now) => {
    const theirs = !!document.querySelector(".topbar .player:nth-child(2).active");
    frames.push([now, now - last, !theirs]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__lt = [];
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration])),
  ).observe({ type: "longtask", buffered: true });
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 : null;
};

const browser = await chromium.launch({
  executablePath,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const out = [];
try {
  for (const name of profiles) {
    const profile = PROFILES[name];
    const context = await browser.newContext({ ...profile.context, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on(
      "console",
      (m) => /didn't answer|rules are off/.test(m.text()) && errors.push(m.text().slice(0, 200)),
    );
    const cdp = await context.newCDPSession(page);
    if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    await page.addInitScript(instrument);
    if (onPage)
      await page.addInitScript(() => {
        window.Worker = class {
          constructor() {
            throw new Error("no workers (--on-page)");
          }
        };
      });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator(".solo-level select").selectOption(level);
    const tap = (l) => (profile.context.hasTouch ? l.tap() : l.click());
    await tap(
      page.locator(game === "rift" ? ".demo.ours button.solo" : ".demo:not(.ours) button.solo").first(),
    );
    await page.locator(".topbar").waitFor();

    // The player's side: move the phases on whenever it is their go, until the computer has had its turns.
    const started = Date.now();
    let computerTurns = 0;
    let wasMine = true;
    let stuckSince = Date.now();
    let lastThinks = 0;
    while (Date.now() - started < 600_000) {
      if (
        await page
          .getByText("The battle is over")
          .isVisible()
          .catch(() => false)
      )
        break;
      const off = page.getByText(/didn't answer within/).first();
      if (await off.isVisible().catch(() => false)) {
        errors.push((await off.textContent()).slice(0, 200));
        break;
      }
      // In a solo game the ▶ shows on both sides' turns: only the player's own turn is moved on.
      const mine = !(await page.locator(".topbar .player:nth-child(2).active").count());
      if (!mine && wasMine) stuckSince = Date.now();
      if (mine && !wasMine) {
        computerTurns++;
        if (computerTurns >= turns) break;
      }
      wasMine = mine;
      for (const label of mine
        ? [/^Go on anyway$/, /^Start anyway$/, /▶/, /^End activation$/, /^Pass$/]
        : []) {
        const b = page.locator(".topbar button").filter({ hasText: label }).first();
        if (await b.isVisible().catch(() => false)) {
          await tap(b).catch(() => {});
          break;
        }
      }
      const thinks = await page.evaluate(() => performance.getEntriesByName("bot:think").length);
      if (thinks !== lastThinks) stuckSince = Date.now();
      lastThinks = thinks;
      if (!mine && Date.now() - stuckSince > 60_000) {
        await page.screenshot({ path: `node_modules/.bot-stuck-${name}.png` });
        errors.push(`no computer move for 60 s (turn ${computerTurns + 1})`);
        break;
      }
      await page.waitForTimeout(250);
    }

    const m = await page.evaluate(() => {
      const thinks = performance.getEntriesByName("bot:think").map((e) => [e.startTime, e.duration]);
      // The computer's turns: runs of frames that aren't the player's, after its first decision.
      const first = thinks[0]?.[0] ?? Infinity;
      const turns = [];
      let from = null;
      for (const [t, , mine] of window.__frames) {
        if (t < first) continue;
        if (!mine && from === null) from = t;
        if (mine && from !== null) {
          turns.push(t - from);
          from = null;
        }
      }
      const theirs = window.__frames.filter(([t, , mine]) => t >= first && !mine).map(([, dt]) => dt);
      const blocking = window.__lt
        .filter(([s]) => s >= first)
        .reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
      // Frames drawn while the computer thought, and the longest gap between them: a stall the player sees.
      const during = window.__frames.filter(([t, dt]) => thinks.some(([s, d]) => t - dt < s + d && t > s));
      const overlap = ([a, da]) => thinks.some(([s, d]) => a < s + d && a + da > s);
      return {
        tasksWhileThinking: window.__lt.filter(overlap).map(([, d]) => Math.round(d)),
        whileThinking: during.map(([, dt]) => dt),
        thinks: thinks.map(([, d]) => d),
        turns,
        theirs,
        blocking,
        longest: Math.max(0, ...window.__lt.filter(([s]) => s >= first).map(([, d]) => d)),
      };
    });
    const row = {
      game,
      profile: name,
      onPage,
      cpu: profile.cpu,
      level,
      decisions: m.thinks.length,
      thinkP50Ms: pct(m.thinks, 0.5),
      thinkP95Ms: pct(m.thinks, 0.95),
      thinkMaxMs: Math.round(Math.max(0, ...m.thinks)),
      thinkTotalMs: Math.round(m.thinks.reduce((a, b) => a + b, 0)),
      computerTurnsS: m.turns.map((t) => Math.round(t / 100) / 10),
      framesWhileThinking: m.whileThinking.length,
      longTasksWhileThinking: m.tasksWhileThinking.sort((a, b) => b - a).slice(0, 8),
      frameWhileThinkingMaxMs: Math.round(Math.max(0, ...m.whileThinking)),
      frameP50Ms: pct(m.theirs, 0.5),
      frameP95Ms: pct(m.theirs, 0.95),
      frameMaxMs: Math.round(Math.max(0, ...m.theirs)),
      longestTaskMs: Math.round(m.longest),
      blockingMs: Math.round(m.blocking),
      errors,
    };
    out.push(row);
    console.error(JSON.stringify(row));
    await context.close();
  }
  console.log(JSON.stringify({ when: new Date().toISOString(), results: out }, null, 2));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
