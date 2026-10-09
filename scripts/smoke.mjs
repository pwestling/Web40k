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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** A replay file's events, wherever the bundle keeps them. */
function eventsIn(json) {
  if (Array.isArray(json) && json.every((e) => e && typeof e === "object" && "event" in e)) return json;
  for (const v of Object.values(json && typeof json === "object" ? json : {})) {
    const found = v && typeof v === "object" ? eventsIn(v) : null;
    if (found?.length) return found;
  }
  return null;
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

  /** Our own game (#42): Play now, with nothing imported: two warbands of stand-ins, a mission, and actions to take. */
  async "play-now"() {
    const { page, context } = await device();
    await lobby(page);
    await page.getByRole("button", { name: /Play now/ }).click();
    await page.locator(".topbar").waitFor();
    await page.locator("canvas").first().waitFor();
    // The battle starts by itself, Lantern Grab set, and "What can I do now?" open on round 1.
    await page.waitForFunction(
      () =>
        document.querySelector(".hud")?.textContent?.includes("Lantern Grab") &&
        document.querySelector(".topbar")?.textContent?.includes("Round 1"),
      null,
      { timeout: 20000 },
    );
    // The army showcase hides the panels while it plays.
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    const toggle = page.locator(".whatnow-toggle");
    if (await toggle.count()) await toggle.click();
    await page
      .locator(".whatnow")
      .getByText(/You can: (Shoot|Fight)|Drag a unit/)
      .first()
      .waitFor({ timeout: 10000 });
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /** The module workshop (#41): a template, its test table, a hot reload on save, the soak bot. */
  async workshop() {
    const { page, context } = await device();
    await lobby(page);
    await page.getByRole("button", { name: /Module workshop/ }).click();
    await page.getByRole("button", { name: /Skirmish/ }).click();
    await page.locator(".cm-editor").waitFor();
    await page.getByRole("button", { name: "Test table" }).first().click();
    await page.getByText("Your rules are running.").waitFor({ timeout: 20000 });
    await page.locator(".workshop-log li").first().waitFor();
    await page.keyboard.press("Escape");
    // Save an edit: the table takes the new package and the rules come back up.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("// edited\n");
    await page.keyboard.press("Control+s");
    await page.getByText("Saved and reloaded onto the test table.").waitFor();
    await page.getByText("Your rules are running.").waitFor({ timeout: 20000 });
    if (await page.locator(".package-card").count()) throw new Error("the table lost the saved package");
    // Types (#43): a wrong ctx call is underlined as it's typed, and Check gives one verdict.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.insertText("function* oops(ctx) { yield ctx.rolll('d6'); }\n");
    await page.locator(".cm-lintRange-error").first().waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await page.locator(".workshop-check.bad").getByText(/rolll/).first().waitFor({ timeout: 120000 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await page.locator(".workshop-check.ok").waitFor({ timeout: 120000 });
    await page.getByRole("tab", { name: "Soak bot" }).click();
    await page.getByRole("button", { name: "Play 3 bot games" }).click();
    await page.locator(".workshop-soak li").nth(2).waitFor({ timeout: 240000 });
    const bad = await page.locator(".workshop-soak li.bad").allTextContents();
    if (bad.length) throw new Error(`soak: ${bad[0]}`);
    if (page.errors.length) throw new Error(page.errors[0]);
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
    await page.locator("summary", { hasText: "More ways to play" }).click();
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

  /**
   * The 40k unit card (#56): in Shooting, "Shoot everything at…" lists each weapon against the
   * target (UX 398); in Charge, "Charge (2D6)" asks which unit first, with the rules' reasons (UX 396).
   */
  async "card-actions"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    const next = async () => {
      await page.locator('.topbar button[title="Next phase"]').click();
      const anyway = page.locator(".topbar .ask button.primary");
      if (await anyway.count()) await anyway.click();
      await page.waitForTimeout(300);
    };
    await next(); // Movement
    await next(); // Shooting
    await page
      .locator("canvas")
      .first()
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("]");
    await page.getByRole("button", { name: "Shoot everything at…" }).click();
    await page.locator(".panel.attack select.attack-target").selectOption({ index: 1 });
    await page.locator(".panel.attack .volley").waitFor();
    await page.locator(".panel.attack").getByRole("button", { name: "Cancel" }).click();
    await next(); // Charge
    await page.getByRole("button", { name: "Charge (2D6)" }).click();
    await page
      .locator(".charge-declare")
      .getByText(/Further than 12"|Roll charge/)
      .first()
      .waitFor();
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * Hotseat (#56, UX 394/395): the first mission is preset, choosing None warns at Start battle with
   * a Pick one, and a reload in the middle goes straight back into the game, not to the lobby.
   */
  async "hotseat-resume"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator("summary", { hasText: "More ways to play" }).click();
    await page.getByRole("button", { name: "Set up a game on this screen (hotseat)" }).click();
    const mission = page.locator(".mission-picker select").first();
    if (!(await mission.inputValue())) throw new Error("hotseat started with no mission");
    await mission.selectOption("");
    await page.getByRole("button", { name: /Start battle/ }).click();
    await page.locator(".ask").getByText("No mission").waitFor();
    await page.getByRole("button", { name: "Pick one" }).click();
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.reload();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    if (await page.locator(".lobby").count()) throw new Error("the reload went back to the lobby");
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * Solo saves (#56, UX 404): in the computer's turn your save roll counts down on its button
   * ("rolls itself in 8…"), then the computer rolls it for you, even at Easy.
   */
  async "solo-saves"() {
    const { page, context } = await device();
    await lobby(page);
    await page
      .locator(".demos .demo", { hasText: "Sci-fi battle" })
      .getByRole("button", { name: "Play the computer" })
      .click();
    await page.locator(".how-hard button", { hasText: /^Easy/ }).click();
    await page.locator(".your-army button").first().click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    // Pass through your turn, phase by phase, until the computer shoots at you.
    const deadline = Date.now() + 150000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("the computer never shot at you in its first turn");
      if (await page.locator(".self-roll-note").count()) break;
      const anyway = page.locator(".topbar .ask button.primary");
      const next = page.locator('.topbar button[title="Next phase"]');
      if (await anyway.count()) await anyway.click().catch(() => {});
      else if (await next.count()) await next.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    // Left alone, the roll is made for you, and the attack goes on.
    await page.locator(".self-roll-note").waitFor({ state: "detached", timeout: 15000 });
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * Play the computer with your own army (#56): How hard?, then Your army with a roster file. Your
   * roster faces the computer's sample army, both at the front of their zones (#56: not 35" apart).
   */
  async "solo-own-army"() {
    const { page, context } = await device();
    await lobby(page);
    await page
      .locator(".demos .demo", { hasText: "Sci-fi battle" })
      .getByRole("button", { name: "Play the computer" })
      .click();
    await page.locator(".how-hard button", { hasText: /^Easy/ }).click();
    await page
      .locator(".your-army input[type=file]")
      .setInputFiles(new URL("./fixtures/test-muster.ros", import.meta.url).pathname);
    // One line to check first (UX 408): the army, its size, the computer's.
    await page
      .locator(".army-check")
      .getByText(/Test Muster · \d+ units/)
      .waitFor();
    await page.getByRole("button", { name: "Save to shelf" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download replay" }).click();
    const path = join(files, "solo.json");
    await (await download).saveAs(path);
    const events = eventsIn(JSON.parse(readFileSync(path, "utf8")));
    const seats = {};
    for (const e of events)
      if (e.event.type === "player/join") seats[e.event.player.id] = e.event.player.seat;
    const fronts = [Infinity, Infinity];
    const armies = new Set();
    for (const e of events.filter((e) => e.event.type === "unit/add")) {
      const seat = seats[e.event.unit.owner];
      if (seat === 0) armies.add(e.event.unit.army);
      for (const m of e.event.models) fronts[seat] = Math.min(fronts[seat], Math.abs(m.position.y));
    }
    if (!armies.has("Test Muster")) throw new Error(`your side is ${[...armies].join(", ")}, not the roster`);
    const gap = fronts[0] + fronts[1];
    if (!(gap > 14 && gap < 28)) throw new Error(`the armies' front lines are ${gap.toFixed(1)}" apart`);
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
    // The roll, then any re-rolls the army's rules ask for (Drilled Volleys re-roll 1s).
    for (let round = 0; round < 3; round++) {
      const ask = await page.locator(".dice-entry strong").first().textContent();
      const n = Number(/(\d+)/.exec(ask ?? "")?.[1]);
      if (!n) throw new Error(`no dice asked for: ${ask}`);
      for (let i = 0; i < n; i++)
        await page
          .locator(".dice-entry .face")
          .nth(i % 6)
          .click();
      await page.waitForTimeout(300);
      // A full roll may go straight on to the re-rolls; otherwise it waits for Use these dice.
      const use = page.getByRole("button", { name: "Use these dice" });
      if ((await use.count()) && (await use.isEnabled())) await use.click();
      await page.waitForTimeout(300);
      if (!(await page.locator(".dice-entry").count())) break;
    }
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

  // A small iPhone (390×664 inside Safari's bars): the army preview's Deploy must be reachable (P1, 2026-10-08).
  async "small-phone"() {
    const { page, context } = await device({
      viewport: { width: 375, height: 600 },
      isMobile: true,
      hasTouch: true,
    });
    await lobby(page);
    await page.getByRole("button", { name: "One phone for both of us" }).click();
    await page.locator(".companion").waitFor();
    for (const who of [0, 1]) {
      const pick = page.getByLabel("Army for");
      if (await pick.count()) await pick.selectOption({ index: who });
      await page.getByRole("button", { name: "Sample army" }).click();
      const deploy = page.getByRole("button", { name: /^Deploy for/ }).first();
      await deploy.scrollIntoViewIfNeeded();
      const box = await deploy.boundingBox();
      if (!box || box.y + box.height > 600) throw new Error(`Deploy is off screen at y=${box?.y}`);
      await deploy.tap();
      await deploy.waitFor({ state: "detached" });
    }
    await page.getByRole("button", { name: /Start battle/ }).waitFor();
    await context.close();
    return page.errors;
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
    await page.locator("summary", { hasText: "More ways to play" }).click();
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
