// Browser smoke tests (#39): one path through each way into the app, against
// the production build. Each check opens a fresh browser context, walks the
// path and fails on a page error or a missing step.
//
//   pnpm smoke                 build, then run every check
//   pnpm smoke --no-build      use the dist/ already built
//   pnpm smoke lesson offline  run only the named checks
//
// CHROMIUM=/path/to/chrome picks the browser; otherwise playwright-core's own
// (CI runs `npx playwright-core install --with-deps chromium` first).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 4180;
const RELAY = 8798;
const BASE = `http://localhost:${PORT}/`;
const SIGNAL = `signal=${encodeURIComponent(`ws://localhost:${RELAY}`)}`;
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));

if (!args.includes("--no-build")) execFileSync("pnpm", ["build"], { stdio: "inherit" });

const executablePath =
  process.env.CHROMIUM ??
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync);

const started = (p, word) =>
  new Promise((resolve, reject) => {
    const on = (d) => String(d).includes(word) && resolve();
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    p.on("exit", (code) => reject(new Error(`exited with ${code}`)));
  });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
const relay = spawn("node", ["server/relay.mjs"], {
  stdio: "pipe",
  detached: true,
  env: { ...process.env, PORT: String(RELAY) },
});
await Promise.all([started(server, "localhost"), started(relay, String(RELAY))]);

const browser = await chromium.launch({
  executablePath,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const files = mkdtempSync(join(tmpdir(), "open-battle-smoke-"));

/** A fresh device: its own storage, page errors collected. */
async function device(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  return { context, page };
}

async function lobby(page, query = "") {
  await page.goto(BASE + query);
  await page.locator(".lobby").waitFor();
}

/** Two sample armies on the table, from the start of a game. */
async function sampleArmies(page) {
  for (const who of [0, 1]) {
    const pick = page.getByLabel("Army for");
    if (await pick.count()) await pick.selectOption({ index: who });
    await page.getByRole("button", { name: "Sample army" }).click();
    const deploy = page.getByRole("button", { name: /^Deploy for/ }).first();
    await deploy.click();
    await deploy.waitFor({ state: "detached" });
  }
}

const checks = {
  async "try-it-now"() {
    const { page, context } = await device();
    await lobby(page);
    const demos = await page.locator(".demos .try").count();
    if (demos < 4) throw new Error(`only ${demos} games to try`);
    for (let i = 0; i < demos; i++) {
      await lobby(page);
      const card = page
        .locator(".demos .demo")
        .filter({ has: page.locator(".try") })
        .nth(i);
      const name = await card.locator("strong").textContent();
      await card.locator(".try").click();
      await page.locator(".topbar").waitFor();
      await page.locator("canvas").first().waitFor();
      await page.waitForTimeout(1500);
      if (!(await page.locator(".unitcard, .panel.hud").count())) throw new Error(`${name}: no panels`);
      if (page.errors.length) throw new Error(`${name}: ${page.errors[0]}`);
      await page.evaluate(() => localStorage.clear());
    }
    await context.close();
  },

  async lesson() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".demos .learn").first().click();
    await page.locator(".coach").waitFor();
    await page.getByRole("button", { name: "Got it" }).click();
    await page
      .locator(".coach")
      .getByText(/step 2 of/i)
      .waitFor();
    await context.close();
    return page.errors;
  },

  async hotseat() {
    const { page, context } = await device();
    await lobby(page);
    await page.getByText("More ways to play").click();
    await page.getByRole("button", { name: /hotseat/ }).click();
    await page.locator(".panel.hud").waitFor();
    await sampleArmies(page);
    await page.getByRole("button", { name: /Start battle/ }).click();
    await page.locator(".topbar").getByText("Round 1").waitFor();
    // A replay of this game, for the replay check.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download replay" }).click();
    await (await download).saveAs(join(files, "replay.json"));
    await context.close();
    return page.errors;
  },

  async "p2p-host-join"() {
    const host = await device();
    const guest = await device();
    await lobby(host.page, `?${SIGNAL}`);
    await host.page.locator(".lobby input").first().fill("Ana");
    await host.page.getByRole("button", { name: "Host a game", exact: true }).click();
    await host.page.locator(".room").waitFor();
    await guest.page.goto(host.page.url());
    await host.page.locator(".room").getByText("connected").waitFor({ timeout: 30_000 });
    await guest.page.locator(".topbar .player").nth(1).waitFor();
    await host.context.close();
    await guest.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  async companion() {
    const { page, context } = await device({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await lobby(page);
    await page.getByRole("button", { name: "One phone for both of us" }).click();
    await page.locator(".companion").waitFor();
    await sampleArmies(page);
    await page.getByRole("button", { name: /Start battle/ }).click();
    await page.getByRole("button", { name: "🎲 Screen dice" }).click();
    await page.locator(".tile").first().click();
    await page.getByRole("button", { name: "Shoot", exact: true }).first().click();
    await page.locator(".table-attack .targets button").first().click();
    await page.getByRole("button", { name: /Declare attack/ }).click();
    await page.locator(".attack-roll").click();
    const ask = await page.locator(".dice-entry strong").first().textContent();
    const n = Number(/(\d+)/.exec(ask ?? "")?.[1]);
    if (!n) throw new Error(`no dice asked for: ${ask}`);
    for (let i = 0; i < n; i++)
      await page
        .locator(".dice-entry .face")
        .nth(i % 6)
        .click();
    await page.getByRole("button", { name: "Use these dice" }).click();
    await page
      .getByText(/^\d+ hits?/)
      .first()
      .waitFor();
    await context.close();
    return page.errors;
  },

  // "A phone each": the host's phone shows the invite link until the other phone opens it (UX 270).
  async "companion-invite"() {
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const host = await device(phone);
    const guest = await device(phone);
    await lobby(host.page, `?${SIGNAL}`);
    await host.page.getByRole("button", { name: "A phone each" }).click();
    await host.page.locator(".companion").waitFor();
    const link = await host.page.locator(".invite-link").textContent();
    if (!link?.includes("room=")) throw new Error(`no invite link: ${link}`);
    await guest.page.goto(link);
    await guest.page.locator(".companion").waitFor();
    await host.page.locator(".invite").waitFor({ state: "detached", timeout: 30_000 });
    // The guest is asked for a name (UX 271).
    await guest.page.getByPlaceholder("Your name").first().waitFor();
    await host.context.close();
    await guest.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  async replay() {
    const path = join(files, "replay.json");
    if (!existsSync(path)) throw new Error("no replay saved (the hotseat check makes it)");
    const { page, context } = await device();
    await lobby(page);
    await page.locator('input[type="file"]').last().setInputFiles(path);
    await page.locator(".replaybar").waitFor();
    await context.close();
    return page.errors;
  },

  async campaign() {
    const { page, context } = await device();
    await lobby(page);
    await page.getByText("More ways to play").click();
    await page.getByRole("button", { name: /hotseat/ }).click();
    await page.locator("details.campaign summary").click();
    await page.getByRole("button", { name: "New campaign book" }).click();
    await page.getByPlaceholder("Campaign name").fill("Smoke League");
    await page.getByRole("button", { name: "Start the book" }).click();
    await page.getByText("Campaign: Smoke League").waitFor();
    await context.close();
    return page.errors;
  },

  async offline() {
    const { page, context } = await device();
    await lobby(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The worker takes over on the next load, then the app comes from its cache.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.locator(".lobby").waitFor();
    await page.getByText("You're offline").first().waitFor();
    await page.locator(".demos .try").first().click();
    await page.locator(".topbar").waitFor();
    await context.close();
    return page.errors;
  },

  async "whats-new"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".whats-new .dot").waitFor();
    await page.locator(".whats-new").click();
    await page.getByRole("dialog", { name: "What's new" }).waitFor();
    await page.reload();
    await page.locator(".whats-new").waitFor();
    if (await page.locator(".whats-new .dot").count()) throw new Error("still marked new after reading");
    await context.close();
    return page.errors;
  },

  async language() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".language-picker select").selectOption("de");
    await page.getByRole("heading", { name: "Wähle ein Spiel" }).waitFor();
    await page.locator(".language-picker select").selectOption("fr");
    await page.getByRole("heading", { name: "Choisis un jeu" }).waitFor();
    await context.close();
    return page.errors;
  },
};

let failed = 0;
for (const [name, run] of Object.entries(checks)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  try {
    const errors = (await run()) ?? [];
    if (errors.length) throw new Error(`page error: ${errors[0]}`);
    console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}
await browser.close();
for (const p of [server, relay]) process.kill(-p.pid);
writeFileSync(join(files, "done"), "");
if (failed) {
  console.log(`${failed} smoke check(s) failed`);
  process.exitCode = 1;
}
