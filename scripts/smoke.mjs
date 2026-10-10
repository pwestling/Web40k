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
import { touch } from "./touch.mjs";

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
  env: { ...process.env, PORT: String(RELAY), OPEN_TABLES: "on", BOARD_ORIGIN: `http://localhost:${PORT}` },
});
await Promise.all([started(server, "localhost"), started(relay, String(RELAY))]);

const browser = await chromium.launch({
  executablePath,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const files = mkdtempSync(join(tmpdir(), "open-battle-smoke-"));

/** A fresh device: its own storage, page errors collected. */
/** #65: two browsers at a ranked Rift Lanterns table from Open tables, played to the result (Ana 1, Ben 0). */
async function rankedToResult() {
  const q = `?${SIGNAL}&openTables=1&board=${encodeURIComponent(`http://localhost:${RELAY}/board`)}`;
  const host = await device();
  const guest = await device();
  const tables = async (page) => {
    await lobby(page, q);
    await page.getByRole("button", { name: /Open tables: find/ }).click();
  };
  await lobby(host.page, q);
  const game = host.page.locator(".lobby label", { hasText: "Game" }).locator("select");
  await game.locator('option[value="rift-lanterns"]').waitFor({ state: "attached", timeout: 20_000 });
  await game.selectOption("rift-lanterns");
  await host.page.getByRole("button", { name: /Open tables: find/ }).click();
  await host.page.getByRole("button", { name: "Host a table and post it" }).click();
  const form = host.page.locator(".post-table");
  await form.locator("label", { hasText: "Your name" }).locator("input").fill("Ana");
  await form.locator("label", { hasText: "Ranked" }).locator("input").check();
  await form.getByRole("button", { name: /^Post:/ }).click();
  await host.page.locator(".room").waitFor();
  await tables(guest.page);
  const post = guest.page.locator(".table-post:not(.live-game)").first();
  await post.getByText("Ranked").first().waitFor({ timeout: 30_000 });
  await post.getByRole("button", { name: "Join" }).click();
  await guest.page.locator(".table-post:not(.live-game) input").first().fill("Ben");
  await guest.page.getByRole("button", { name: "Join Ana" }).click();
  // Opt-in: the guest says yes to ranked, on the card that greets them at the table (PX ranked 7).
  await guest.page
    .locator(".arrival")
    .getByRole("button", { name: "Play ranked" })
    .click({ timeout: 30_000 });
  await host.page.locator(".topbar .ranked-chip").waitFor({ timeout: 15_000 });
  for (const [i, { page }] of [host, guest].entries()) {
    await page.locator('.panel.hud select[aria-label="Sample army"]').selectOption({ index: i + 1 });
    const deploy = page.getByRole("button", { name: /^Deploy for/ }).first();
    if (await deploy.count()) await deploy.click();
  }
  await host.page.getByRole("button", { name: /Start battle/ }).click();
  const anyway = host.page.getByRole("button", { name: /Start anyway/ });
  if (await anyway.count()) await anyway.first().click();
  await host.page
    .locator(".topbar")
    .getByText(/Round 1/)
    .first()
    .waitFor({ timeout: 15_000 });
  for (const { page } of [host, guest]) await page.keyboard.press("Escape");
  // Ana scores a point by hand, then both pass every round to the end.
  await host.page.locator(".topbar .player").first().getByRole("button", { name: "+" }).click();
  const deadline = Date.now() + 120_000;
  while (!(await host.page.locator(".ranked-sign").count())) {
    if (Date.now() > deadline) throw new Error("the ranked game never reached its result");
    for (const { page } of [host, guest]) {
      const pass = page.locator(".topbar").getByRole("button", { name: "Pass", exact: true });
      if (await pass.isEnabled().catch(() => false)) await pass.click({ timeout: 1500 }).catch(() => {});
      const ask = page.locator(".topbar .ask button.primary");
      if (await ask.count())
        await ask
          .first()
          .click()
          .catch(() => {});
    }
    await sleep(300);
  }
  return { host, guest, tables };
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An iPad (#60): touch only, so the app sees fingers, not a mouse. */
const IPAD = { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true };

/** On a tablet, by touch: past the showcase, then the top-down view from the table's long-press menu. */
async function touchTable(page, t, top = true) {
  await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 30000 });
  for (let i = 0; i < 60 && (await page.evaluate(() => document.body.classList.contains("showcase"))); i++) {
    await t.tap(600, 420);
    await sleep(400);
  }
  await sleep(1500);
  if (top) await topDown(page, t);
}

/** The top-down view, from the table's long-press menu. */
async function topDown(page, t) {
  await t.press(600, 450, 700);
  await page.locator(".touch-menu").waitFor({ timeout: 5000 });
  await page.locator(".touch-menu").getByRole("menuitem", { name: "Top-down view" }).tap();
  await sleep(2000);
}

/** A unit of the side to play, picked by tapping around its name plate; where to put a finger on it. */
async function tapOwnUnit(page, t) {
  const who = (await page.locator(".topbar .turn strong").textContent()).split(" · ").at(-1).trim();
  const plates = await page.locator(".plate [data-unit]").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.dataset.unit, x: r.x + r.width / 2, y: r.y + r.height / 2, name: e.textContent.trim() };
    }),
  );
  for (const pl of plates)
    for (const [dx, dy] of [
      [0, 0],
      [0, 10],
      [0, -10],
      [10, 0],
      [-10, 0],
      [16, 0],
      [-16, 0],
      [0, 18],
      [0, 28],
      [0, 38],
    ]) {
      await t.tap(pl.x + dx, pl.y + dy);
      await sleep(400);
      // A slow page can read a quick tap as a long press: put its menu away.
      if (await page.locator(".touch-menu").count()) await page.locator(".touch-menu-scrim").tap();
      const card = await page
        .locator(".unitcard")
        .first()
        .textContent({ timeout: 500 })
        .catch(() => "");
      if (card.includes(pl.name.replace(/^[^A-Za-z]+/, "").slice(0, 12)) && card.includes(who)) {
        // Selecting can slide the view over for the card: follow the plate.
        await sleep(1500);
        const now = await page.locator(`.plate [data-unit="${pl.id}"]`).boundingBox();
        return { id: pl.id, x: now.x + now.width / 2 + dx, y: now.y + now.height / 2 + dy };
      }
    }
  throw new Error(`no unit of ${who} could be picked by tapping`);
}

/**
 * Drag a unit by one finger and check its plate followed. Software WebGL can take longer than a long press to
 * draw one frame, so the press may read as "hold, then drag" (a ruler): then it's put away and tried again.
 */
async function touchMove(page, t, u, by) {
  const plate = page.locator(`.plate [data-unit="${u.id}"]`);
  const before = await plate.boundingBox();
  for (let i = 0; i < 4; i++) {
    await t.drag({ x: u.x, y: u.y }, { x: u.x + by.x, y: u.y + by.y }, { stepMs: 40 });
    await sleep(1000);
    const after = await plate.boundingBox();
    if (Math.hypot(after.x - before.x, after.y - before.y) >= 15) return;
    await sleep(1500);
  }
  if (process.env.SMOKE_SHOTS)
    await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "touch-move.png") });
  throw new Error(`a one-finger drag from ${Math.round(u.x)},${Math.round(u.y)} didn't move ${u.id}`);
}

/** Touch targets under 44 px, and anything off screen, at this size. */
const smallTargets = (page) =>
  page.evaluate(() => {
    const small = [...document.querySelectorAll("button, [role=button], select, input, summary, label.file")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (
          !r.width ||
          !r.height ||
          getComputedStyle(e).visibility === "hidden" ||
          e.closest("[aria-hidden=true]")
        )
          return false;
        if (e.matches("input[type=checkbox], input[type=radio]"))
          return (e.closest("label")?.getBoundingClientRect().height ?? 0) < 44;
        return r.height < 44 || r.width < 44;
      })
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      });
    const wide =
      document.documentElement.scrollWidth > innerWidth
        ? [`page ${document.documentElement.scrollWidth}px wide`]
        : [];
    return [...wide, ...small];
  });

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
    await page
      .locator(".demo.ours", { hasText: "Rift Lanterns" })
      .getByRole("button", { name: /Play now/ })
      .click();
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
    await page.getByRole("button", { name: "⋯ Game" }).click();
    await page.getByRole("menuitem", { name: "Download replay" }).click();
    await (await download).saveAs(join(files, "replay.json"));
    await context.close();
    return page.errors;
  },

  /**
   * Clips (#56, PX dogfood 3): the whole battle is a cut of about a minute, with Full length
   * beside it, for a replay opened from its file.
   */
  async "clip-options"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    for (let i = 0; i < 12; i++) {
      await page.locator('.topbar button[title="Next phase"]').click();
      const anyway = page.locator(".topbar .ask button.primary");
      if (await anyway.count()) await anyway.click();
      await page.waitForTimeout(150);
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "⋯ Game" }).click();
    await page.getByRole("menuitem", { name: "Download replay" }).click();
    const path = join(files, "clip.json");
    await (await download).saveAs(path);
    await lobby(page);
    await page.locator("label.file", { hasText: "Open a replay file" }).locator("input").setInputFiles(path);
    await page.getByRole("button", { name: "Share…" }).click();
    const cut = page.locator(".share-options label", { hasText: "The whole battle, cut down" });
    const about = Number((await cut.innerText()).match(/about (\d+) s/)?.[1]);
    if (!(about > 0 && about <= 60)) throw new Error(`the cut-down battle is about ${about} s`);
    await page.locator(".share-options label", { hasText: "Full length" }).waitFor();
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * The 40k unit card (#56): in Shooting, "Shoot everything at…" lists each weapon against the
   * target (UX 398); in Charge, "Charge (2D6)" asks which unit first, with the rules' reasons (UX 396).
   */
  /** Porter: a move in legs, round a ruin. Space mid-drag turns a corner; the ruler counts the legs. */
  async "move-legs"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    await page.locator('.topbar button[title="Next phase"]').click();
    const anyway = page.locator(".topbar .ask button.primary");
    if (await anyway.count()) await anyway.click();
    await page.keyboard.press("]");
    await sleep(1500);
    // The selected unit's plate: the one named as the card is.
    const name = (await page.locator(".unitcard").first().innerText()).split("\n")[0].trim();
    const unit = await page.locator(".plate [data-unit]").evaluateAll((els, name) => {
      const sel = els.find((e) => e.textContent.includes(name)) ?? els[0];
      const r = sel.getBoundingClientRect();
      return { id: sel.dataset.unit, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    const label = page.locator(".ruler", { hasText: '"' });
    let dragging = false;
    for (const dy of [18, 28, 38, 48, 10, 60]) {
      await page.mouse.move(unit.x, unit.y + dy);
      await page.mouse.down();
      await page.mouse.move(unit.x + 40, unit.y + dy, { steps: 6 });
      await sleep(200);
      if (await label.count()) {
        dragging = true;
        await page.keyboard.press("Space");
        await page.mouse.move(unit.x + 40, unit.y + dy - 40, { steps: 6 });
        await sleep(200);
        const text = await label.first().textContent();
        if (!/in 2 legs/.test(text)) throw new Error(`the move label says "${text}", not 2 legs`);
        await page.mouse.up();
        break;
      }
      await page.mouse.up();
      await page.keyboard.press("Escape");
      await page.keyboard.press("]");
    }
    if (!dragging) {
      if (process.env.SMOKE_SHOTS)
        await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "move-legs.png") });
      throw new Error(`no model of ${JSON.stringify(unit)} could be dragged`);
    }
    await sleep(800);
    const moved = Number(
      (await page.locator(".unitcard").first().innerText()).match(/Moved ([\d.]+)/)?.[1] ?? NaN,
    );
    if (!(moved > 0)) throw new Error(`the card says Moved ${moved}`);
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "move-legs.png") });
    // Too far: pulled back along its legs, it has moved exactly its limit.
    const snap = page.getByRole("button", { name: /^Snap back to/ });
    if (await snap.count()) {
      const limit = Number((await snap.textContent()).match(/([\d.]+)/)[1]);
      await snap.click();
      await sleep(800);
      const after = Number(
        (await page.locator(".unitcard").first().innerText()).match(/Moved ([\d.]+)/)?.[1],
      );
      if (Math.abs(after - limit) > 0.15) throw new Error(`snapped back to ${after}", not ${limit}"`);
    }
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

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
    // With nothing within 12" the button says so and asks "Charge anyway?" (UX 434).
    await page.getByRole("button", { name: /^Charge(: no enemy| \(2D6\))/ }).click();
    await page
      .locator(".charge-declare")
      .getByText(/no charge possible|Roll charge|Charge anyway/)
      .first()
      .waitFor();
    // Status chips only show (UX 399): the ⋯ beside them marks one, on purpose.
    await page.locator(".panel.unitcard .status-menu summary").click();
    await page.locator(".panel.unitcard .status-menu button", { hasText: "Mark Fought" }).click();
    await page.locator(".panel.unitcard .chips .chip", { hasText: "Fought" }).waitFor();
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * Unit cards fit (#56, UX 400/401): in each generic system's demo, no stats table is wider than the
   * card (FSD's Systems and Conquest's specials go on rows of their own), and the stats come first.
   */
  async "card-widths"() {
    const { page, context } = await device();
    for (const demo of ["Full Spectrum Dominance", "Conquest", "Rank and flank"]) {
      await lobby(page);
      await page.locator(".demos .demo", { hasText: demo }).locator(".try").click();
      await page
        .locator(".topbar")
        .getByText(/Round 1|Deploy/)
        .first()
        .waitFor({ timeout: 20000 });
      await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, {
        timeout: 30000,
      });
      await page.keyboard.press("Escape");
      await page
        .locator("canvas")
        .first()
        .click({ position: { x: 5, y: 5 } });
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("]");
        await page.waitForTimeout(150);
        const over = await page.evaluate(() => {
          const card = document.querySelector(".panel.unitcard");
          if (!card) return null;
          const wide = [...card.querySelectorAll("table")].find((t) => t.scrollWidth > card.clientWidth);
          return wide
            ? `${card.querySelector("h2")?.textContent}: ${wide.scrollWidth} > ${card.clientWidth}`
            : null;
        });
        if (over) throw new Error(`${demo}: ${over}`);
        // The stats sit under the name, not below the regiment's manoeuvres (UX 401).
        const low = await page.evaluate(() => {
          const card = document.querySelector(".panel.unitcard");
          const stats = card?.querySelector("table.stats");
          if (!card || !stats) return null;
          const top = stats.getBoundingClientRect().top - card.getBoundingClientRect().top;
          return top > 150
            ? `${card.querySelector("h2")?.textContent}: stats ${Math.round(top)}px down`
            : null;
        });
        if (low) throw new Error(`${demo}: ${low}`);
      }
    }
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
    // Resume names the computer's level from the saved game, not its side's name (UX 439).
    await lobby(page);
    await page.locator(".resume-top").getByText("Against the computer (Easy)").waitFor();
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
      .getByText(/Test Muster · \d+ units · 165 pts · the list itself says 335 pts/)
      .waitFor();
    // About 4 to 1 against the computer's sample is said in words, with a way to even it (PX re-check of #56).
    await page
      .locator(".your-army .warn")
      .getByText(/The computer's army is about \d+ times yours/)
      .waitFor();
    await page.getByRole("button", { name: "Save to shelf" }).click();
    await page.getByRole("button", { name: "Match my points" }).click();
    // It says what the computer now fields and leaves Start to the player (PX re-check of #56).
    await page
      .locator(".army-check")
      .getByText(/the computer's is [1-3]\d\d pts/)
      .waitFor();
    if (await page.getByText(/The computer's army is about/).count())
      throw new Error("still lopsided after matching");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "⋯ Game" }).click();
    await page.getByRole("menuitem", { name: "Download replay" }).click();
    const path = join(files, "solo.json");
    await (await download).saveAs(path);
    const events = eventsIn(JSON.parse(readFileSync(path, "utf8")));
    const seats = {};
    for (const e of events)
      if (e.event.type === "player/join") seats[e.event.player.id] = e.event.player.seat;
    const fronts = [Infinity, Infinity];
    const armies = new Set();
    const points = [0, 0];
    for (const e of events.filter((e) => e.event.type === "unit/add")) {
      const seat = seats[e.event.unit.owner];
      if (seat === 0) armies.add(e.event.unit.army);
      points[seat] += e.event.unit.sheet?.points ?? 0;
      for (const m of e.event.models) fronts[seat] = Math.min(fronts[seat], Math.abs(m.position.y));
    }
    if (!armies.has("Test Muster")) throw new Error(`your side is ${[...armies].join(", ")}, not the roster`);
    if (points[1] > 400)
      throw new Error(`Match my points left the computer ${points[1]} pts against ${points[0]}`);
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
    // The name is asked at once, while the table connects (UX 403), and used once seated.
    await guest.page.getByText(/What should the others call you/).waitFor({ timeout: 10_000 });
    await guest.page.getByPlaceholder("Your name").fill("Ben");
    await guest.page.getByRole("button", { name: "Use this name" }).click();
    await host.page.locator(".room").getByText("connected").waitFor({ timeout: 30_000 });
    await guest.page.locator(".topbar .player").nth(1).waitFor();
    await host.page.locator(".topbar").getByText("Ben").first().waitFor({ timeout: 15_000 });
    await host.context.close();
    await guest.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  // #64: a public table, posted with watchers allowed, filled, then watched
  // from Live now on a third device. The board is the relay's own.
  async "live-now"() {
    const q = `?${SIGNAL}&openTables=1&board=${encodeURIComponent(`http://localhost:${RELAY}/board`)}`;
    const host = await device();
    const guest = await device();
    const watcher = await device();
    const tables = async (page) => {
      await lobby(page, q);
      await page.getByRole("button", { name: /Open tables: find/ }).click();
    };
    await tables(host.page);
    await host.page.getByRole("button", { name: "Host a table and post it" }).click();
    const form = host.page.locator(".post-table");
    await form.locator("label", { hasText: "Your name" }).locator("input").fill("Ana");
    if (!(await form.locator("label", { hasText: "Allow watchers" }).locator("input").isChecked()))
      throw new Error("Allow watchers is not on by default");
    await form.getByRole("button", { name: /^Post:/ }).click();
    await host.page.locator(".room").waitFor();
    await tables(guest.page);
    const post = guest.page.locator(".table-post:not(.live-game)").first();
    await post.getByRole("button", { name: "Join" }).click({ timeout: 30_000 });
    await guest.page.locator(".table-post:not(.live-game) input").first().fill("Ben");
    await guest.page.getByRole("button", { name: "Join Ana" }).click();
    await host.page.locator(".topbar").getByText("Ben").first().waitFor({ timeout: 30_000 });
    for (const { page } of [host, guest]) {
      await page.getByRole("button", { name: "Sample army" }).first().click();
      const deploy = page.getByRole("button", { name: /^Deploy for/ }).first();
      await deploy.click();
      await deploy.waitFor({ state: "detached" });
    }
    await host.page.getByRole("button", { name: /Start battle/ }).click();
    const anyway = host.page.getByRole("button", { name: /Start anyway/ });
    if (await anyway.count()) await anyway.first().click();
    await tables(watcher.page);
    // The board is polled, so a just-filled table can take a round to show as live.
    const live = watcher.page.locator(".live-game").first();
    await live.waitFor({ timeout: 45_000 });
    await live.getByRole("button", { name: "Watch" }).click();
    await watcher.page
      .locator(".broadcast-badge")
      .getByText(/^\d+ s behind$/)
      .waitFor({ timeout: 30_000 });
    await host.page
      .locator(".watching-chip")
      .getByText(/1 watching/)
      .waitFor({ timeout: 30_000 });
    for (const d of [host, guest, watcher]) await d.context.close();
    return [...host.page.errors, ...guest.page.errors, ...watcher.page.errors];
  },

  // #65: a ranked Rift Lanterns game between two browsers, both sign, and after a reload
  // both ladders (worked out on each device from the signed result) agree.
  async ranked() {
    const { host, guest, tables } = await rankedToResult();
    for (const { page } of [host, guest])
      await page
        .locator(".ranked-sign")
        .first()
        .getByRole("button", { name: /^Sign: / })
        .click({ timeout: 20_000 });
    for (const { page } of [host, guest])
      await page.locator(".ranked-sign.good").first().waitFor({ timeout: 20_000 });
    // The winner sees the climb, the loser the cost and what wins it back (PX ranked 2).
    await host.page
      .locator(".ranked-sign .rating-move", { hasText: "1,516 (+16)" })
      .first()
      .waitFor({ timeout: 20_000 });
    await guest.page
      .locator(".ranked-sign", { hasText: /1,484 \(−16\).*A win against Ana wins back 17/s })
      .first()
      .waitFor({ timeout: 20_000 });
    const ladders = [];
    for (const { page } of [host, guest]) {
      await tables(page);
      await page.locator(".open-tables").getByRole("button", { name: "Ladder" }).click();
      const table = page.locator(".player-card table.ladder");
      await table.waitFor({ timeout: 20_000 });
      ladders.push(await table.innerText());
    }
    if (ladders[0] !== ladders[1]) throw new Error(`the ladders differ: ${JSON.stringify(ladders)}`);
    if (!/1\tAna\b.*\t1,516\?/.test(ladders[0]))
      throw new Error(`unexpected ladder: ${JSON.stringify(ladders[0])}`);
    for (const d of [host, guest]) await d.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  // PX ranked 1: "Don't sign" asks why. A wrong score is fixed on the table and written up again;
  // a refusal shows kindly on both sides and in each player's sign rate.
  async "ranked-refusal"() {
    const { host, guest, tables } = await rankedToResult();
    const sign = (page) => page.locator(".ranked-sign").first();
    await sign(guest.page).getByRole("button", { name: "Don't sign" }).click({ timeout: 20_000 });
    await sign(guest.page).getByRole("button", { name: "The score is wrong" }).click();
    await sign(host.page)
      .getByText(/Ben says the score is wrong/)
      .waitFor({ timeout: 20_000 });
    // Ben's point was missed: he puts it on, and the result is written again as a draw.
    await guest.page.locator(".topbar .player").nth(1).getByRole("button", { name: "+" }).click();
    await sign(guest.page).getByRole("button", { name: "Score fixed: write it up" }).click();
    await sign(host.page)
      .getByText(/Ana 1 – 1 Ben, a draw/)
      .waitFor({ timeout: 20_000 });
    await sign(host.page)
      .getByRole("button", { name: /^Sign: / })
      .click({ timeout: 20_000 });
    await sign(guest.page).getByRole("button", { name: "Don't sign" }).click({ timeout: 20_000 });
    await sign(guest.page).getByRole("button", { name: "We agreed it wouldn't count" }).click();
    await sign(guest.page)
      .getByText("You didn't sign, so this game doesn't count for either of you.")
      .waitFor({ timeout: 20_000 });
    await sign(host.page)
      .getByText(/Ben didn't sign, so it won't move the ladder/)
      .waitFor({ timeout: 20_000 });
    await sign(host.page).getByText("Ben said: We agreed it wouldn't count").waitFor();
    // Each card counts it: Ana signed, Ben didn't.
    for (const [{ page }, line] of [
      [host, "You've signed 1 of 1 result."],
      [guest, "You've signed 0 of 1 result."],
    ]) {
      await tables(page);
      await page.locator(".open-tables").getByRole("button", { name: "Ladder" }).click();
      await page.locator(".player-card").getByRole("button", { name: "Your player card" }).click();
      await page.locator(".player-card").getByText(line).waitFor({ timeout: 30_000 });
    }
    for (const d of [host, guest]) await d.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  // #67: an online event with four browsers and no server of its own: Ana runs it, all four
  // enter with a shelf army, two Swiss rounds are played as ranked games from one-click
  // pairings, and every browser ends on the same final standings.
  async events() {
    const q = `?${SIGNAL}&openTables=1&board=${encodeURIComponent(`http://localhost:${RELAY}/board`)}`;
    const names = ["Ana", "Ben", "Cy", "Dee"];
    const step = (x) => process.env.SMOKE_STEPS && console.log(new Date().toISOString().slice(11, 19), x);
    const ds = [];
    for (const name of names) {
      const d = await device();
      d.name = name;
      ds.push(d);
      step(`shelf army for ${name}`);
      // A shelf army: deploy Rift Lanterns' sample warband at a table of one's own and save it.
      await lobby(d.page, q);
      await d.page.locator(".lobby label", { hasText: "Your name" }).locator("input").fill(name);
      const game = d.page.locator(".lobby label", { hasText: "Game" }).locator("select");
      await game.locator('option[value="rift-lanterns"]').waitFor({ state: "attached", timeout: 20_000 });
      await game.selectOption("rift-lanterns");
      await d.page.getByRole("button", { name: /^Host/ }).first().click();
      await d.page.locator('.panel.hud select[aria-label="Sample army"]').selectOption({ index: 1 });
      await d.page
        .getByRole("button", { name: /^Deploy for/ })
        .first()
        .click();
      await d.page.getByRole("button", { name: "Save army to your shelf" }).click();
      await d.page.getByText("This army is on your shelf as it is now.").waitFor();
    }
    const board = async (page) => {
      await lobby(page, q);
      await page.getByRole("button", { name: /Open tables: find/ }).click();
    };
    const [ana] = ds;
    const watcher = await device();
    step("run the event");
    await board(ana.page);
    await ana.page.locator(".events-section").getByRole("button", { name: "Run an event" }).click();
    const form = ana.page.locator(".run-event");
    await form.locator("label", { hasText: "Name" }).first().locator("input").fill("Smoke Cup");
    await form.locator("label", { hasText: "Game" }).locator("select").selectOption("rift-lanterns");
    await form.locator("label", { hasText: "Rounds" }).locator("input").fill("2");
    await form.getByRole("button", { name: "Post the event" }).click();
    const page = (d) => d.page.locator(".event-page");
    for (const d of ds) {
      if (d !== ana) {
        await board(d.page);
        const card = d.page.locator(".events-section .event-card", { hasText: "Smoke Cup" });
        await card.waitFor({ timeout: 30_000 });
        await card.getByRole("button", { name: "Open" }).click();
      }
      step(`${d.name} enters`);
      await page(d).getByRole("button", { name: "Enter" }).click({ timeout: 20_000 });
      await page(d)
        .getByText(/^You're in/)
        .waitFor({ timeout: 20_000 });
    }
    step("start");
    // The organiser's device takes all four entries, then starts it.
    await page(ana)
      .locator(".event-entries li:not(:has-text('waiting'))")
      .nth(3)
      .waitFor({ timeout: 45_000 });
    await page(ana).getByRole("button", { name: "Start now" }).click();

    for (const round of [1, 2]) {
      for (const d of ds) {
        if (round === 2) {
          await d.page.getByRole("button", { name: "Back to the event" }).first().click({ timeout: 20_000 });
        }
        step(`round ${round}: ${d.name} to the table`);
        const play = page(d).getByRole("button", { name: /^Play your game: table \d+$/ });
        await play.waitFor({ timeout: 90_000 });
        await page(d)
          .getByRole("heading", { name: new RegExp(`^Round ${round}`) })
          .first()
          .waitFor();
        await play.click();
      }
      step(`round ${round}: deploy`);
      // Each puts down the army they entered with; the host of each table starts the battle.
      for (const d of ds) {
        const deploy = d.page.locator(".event-seat").getByRole("button", { name: /^Deploy / });
        await deploy.click({ timeout: 60_000 });
      }
      step(`round ${round}: checks`);
      for (const d of ds) {
        await d.page.locator(".event-seat li.good").nth(1).waitFor({ timeout: 30_000 });
        await d.page.locator(".topbar .ranked-chip").waitFor({ timeout: 30_000 });
      }
      step(`round ${round}: start battles`);
      for (const d of ds) {
        // Each table's host starts it.
        if (
          !(await d.page
            .locator(".room .people")
            .getByText(/^you · host/)
            .count())
        )
          continue;
        const start = d.page.locator(".topbar").getByRole("button", { name: /Start battle/ });
        if (process.env.SMOKE_SHOTS)
          await d.page.screenshot({ path: `${process.env.SMOKE_SHOTS}/${d.name}-${round}.png` });
        await start.click();
        const anyway = d.page.getByRole("button", { name: /Start anyway/ });
        if (await anyway.count()) await anyway.first().click();
      }
      // Every guest's table matches its host's, though the game's rules package loaded as they joined.
      await sleep(3000);
      for (const d of ds)
        if (await d.page.locator(".net-banner.desync").count())
          throw new Error(`round ${round}: ${d.name}'s table doesn't match the host's`);
      for (const d of ds) {
        await d.page
          .locator(".topbar")
          .getByText(/Round 1/)
          .first()
          .waitFor({ timeout: 20_000 });
        await d.page.keyboard.press("Escape");
      }
      // Round 1: someone watches a top table from Live now, behind the game.
      if (round === 1) {
        step("watch from Live now");
        await board(watcher.page);
        const live = watcher.page.locator(".live-game", { hasText: "Smoke Cup" }).first();
        await live.waitFor({ timeout: 45_000 });
        await live.getByRole("button", { name: "Watch" }).click();
        await watcher.page.locator(".broadcast-badge").waitFor({ timeout: 30_000 });
      }
      // Each table's first side scores a point, then everyone passes to the end.
      for (const d of ds) {
        const plus = d.page.locator(".topbar .player").first().getByRole("button", { name: "+" });
        if ((await d.page.locator(".topbar .player").first().innerText()).includes(d.name))
          await plus.click();
      }
      step(`round ${round}: play`);
      const deadline = Date.now() + 240_000;
      while (true) {
        let done = 0;
        for (const d of ds) {
          if (await d.page.locator(".ranked-sign").count()) {
            done++;
            continue;
          }
          const pass = d.page.locator(".topbar").getByRole("button", { name: "Pass", exact: true });
          if (await pass.isEnabled().catch(() => false)) await pass.click({ timeout: 1500 }).catch(() => {});
          const ask = d.page.locator(".topbar .ask button.primary");
          if (await ask.count())
            await ask
              .first()
              .click()
              .catch(() => {});
        }
        if (done === ds.length) break;
        if (Date.now() > deadline) throw new Error(`round ${round}'s games never reached their results`);
        await sleep(300);
      }
      for (const d of ds)
        await d.page
          .locator(".ranked-sign")
          .first()
          .getByRole("button", { name: /^Sign: / })
          .click({ timeout: 30_000 });
      for (const d of ds) await d.page.locator(".ranked-sign.good").first().waitFor({ timeout: 30_000 });
      // The watcher saw the end, on the same table as the players: the game's rules package loaded for it too.
      if (round === 1) {
        await watcher.page.locator(".topbar").getByText("Battle over").waitFor({ timeout: 30_000 });
        if (await watcher.page.locator(".net-banner.desync").count())
          throw new Error("the watcher's table doesn't match the game it watched");
      }
    }
    step("final standings");
    // Back on the event: every browser works out the same final standings.
    const tables = [];
    for (const d of ds) {
      await d.page.getByRole("button", { name: "Back to the event" }).first().click({ timeout: 20_000 });
      await page(d).getByRole("heading", { name: "Final standings" }).waitFor({ timeout: 120_000 });
      await sleep(500);
      tables.push(await page(d).locator("table.standings").innerText());
    }
    const strip = (x) => x.replace(/\t(Drop|Back in)?$/gm, "");
    if (new Set(tables.map(strip)).size !== 1)
      throw new Error(`the standings differ: ${JSON.stringify(tables)}`);
    if (!/\t6\t2–0–0\t/.test(tables[0])) throw new Error(`no one won both: ${JSON.stringify(tables[0])}`);
    for (const d of [...ds, watcher]) await d.context.close();
    return [...ds, watcher].flatMap((d) => d.page.errors);
  },

  // #68: three miniatures photographed (drawn here as JPEGs of a painted figure on paper), two on a
  // laptop and one on a phone, stand on the table in both browsers, within the texture budget.
  async standees() {
    const host = await device();
    const guest = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await lobby(host.page, `?${SIGNAL}`);
    await host.page.locator(".lobby input").first().fill("Ana");
    await host.page.getByRole("button", { name: "Host a game", exact: true }).click();
    await host.page.locator(".room").waitFor();
    await guest.page.goto(host.page.url());
    await guest.page.getByPlaceholder("Your name").fill("Ben");
    await guest.page.getByRole("button", { name: "Use this name" }).click();
    await host.page.locator(".room").getByText("connected").waitFor({ timeout: 30_000 });
    for (const d of [host, guest]) {
      await d.page.getByRole("button", { name: "Sample army" }).click();
      await d.page
        .getByRole("button", { name: /^Deploy for/ })
        .first()
        .click();
    }
    await guest.page.keyboard.press("Escape");
    const names = [];
    const dress = async (d, seed) => {
      const { page } = d;
      const card = page.locator(".panel.unitcard");
      const title = async () =>
        (await card.count()) ? (await card.locator("h2, h3").first().innerText()).trim() : "";
      // One of this player's units not dressed yet.
      for (let k = 0; k < 12 && (!(await title()) || names.includes(await title())); k++)
        await page.keyboard.press("]");
      const name = await title();
      names.push(name);
      const figures = card.locator("details.figures");
      if ((await figures.getAttribute("open")) === null) await figures.locator("> summary").click();
      await card
        .getByRole("button", { name: /Photo…|Photograph it…/ })
        .first()
        .click();
      const maker = page.locator(".standee-maker");
      // A phone photo: a painted figure on a sheet of paper lit from one side, with its shadow, as a JPEG.
      await page.evaluate(async (seed) => {
        const c = document.createElement("canvas");
        c.width = 900;
        c.height = 1200;
        const g = c.getContext("2d");
        const paper = g.createLinearGradient(0, 0, 900, 0);
        paper.addColorStop(0, "#efece6");
        paper.addColorStop(1, "#cfcac0");
        g.fillStyle = paper;
        g.fillRect(0, 0, 900, 1200);
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.beginPath();
        g.ellipse(520, 1010, 230, 40, 0, 0, Math.PI * 2);
        g.fill();
        const hue = [0, 120, 220][seed];
        g.fillStyle = "#26262b";
        g.beginPath();
        g.ellipse(450, 1000, 200, 36, 0, 0, Math.PI * 2);
        g.fill();
        g.fillRect(250, 950, 400, 50);
        g.fillStyle = `hsl(${hue} 60% 38%)`;
        g.fillRect(380, 520, 140, 430);
        g.fillRect(330, 560, 50, 260);
        g.fillRect(520, 560, 50, 260);
        g.fillStyle = "#c9a27c";
        g.beginPath();
        g.arc(450, 450, 70, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#8a6d3b";
        g.lineWidth = 14;
        g.beginPath();
        g.moveTo(560, 800);
        g.lineTo(640 + seed * 30, 300);
        g.stroke();
        for (let i = 0; i < 4000; i++) {
          g.fillStyle = `rgba(${Math.random() > 0.5 ? "255,255,255" : "0,0,0"},0.05)`;
          g.fillRect(Math.random() * 900, Math.random() * 1200, 2, 2);
        }
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
        const input = [...document.querySelectorAll(".standee-maker input[type=file]")].find(
          (i) => !i.capture,
        );
        const dt = new DataTransfer();
        dt.items.add(new File([blob], `photo-${seed}.jpg`, { type: "image/jpeg" }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, seed);
      await maker.locator(".cutout-editor canvas").waitFor();
      // The page behind the maker is inert (UX 472): the dialog's Undo is the only one a screen reader finds.
      const undos = await page.evaluate(
        () =>
          [...document.querySelectorAll("button")].filter(
            (b) => b.textContent.trim() === "Undo" && !b.closest("[inert]"),
          ).length,
      );
      if (undos !== 1) throw new Error(`${undos} Undo buttons reachable while the standee maker is open`);
      if ((await maker.getAttribute("aria-modal")) !== "true")
        throw new Error("the standee maker isn't aria-modal");
      if (process.env.SMOKE_SHOTS)
        await page.screenshot({ path: join(process.env.SMOKE_SHOTS, `standee-maker-${seed}.png`) });
      await maker.getByRole("button", { name: /^Use for/ }).click();
      await maker.waitFor({ state: "detached", timeout: 30_000 });
      if (await page.locator("[inert]").count())
        throw new Error("the page stayed inert after the standee maker closed");
      if ((await figures.getAttribute("open")) === null) await figures.locator("> summary").click();
      await card.locator('button[title="Back to the stand-in"]').first().waitFor({ timeout: 30_000 });
    };
    await host.page
      .locator("canvas")
      .first()
      .click({ position: { x: 5, y: 5 } });
    await dress(host, 0);
    await dress(host, 1);
    await dress(guest, 2);
    // Both browsers have all three: each figure library notes the standees that reached it.
    const library = (page) =>
      page.evaluate(async () => {
        const db = await new Promise((r) => {
          const req = indexedDB.open("open-battle-figures");
          req.onsuccess = () => r(req.result);
          req.onerror = () => r(null);
        });
        if (!db) return [];
        const out = [];
        for (const n of db.objectStoreNames) {
          const all = await new Promise((r) => {
            const req = db.transaction(n).objectStore(n).getAll();
            req.onsuccess = () => r(req.result);
          });
          for (const e of all)
            if (e?.name?.endsWith(" standee"))
              out.push({ name: e.name, bytes: e.bytes, triangles: e.triangles, height: e.height });
        }
        return out;
      });
    for (const d of [host, guest]) {
      let got = [];
      for (let i = 0; i < 40 && got.length < 3; i++) {
        got = await library(d.page);
        if (got.length < 3) await d.page.waitForTimeout(500);
      }
      if (got.length !== 3)
        throw new Error(`a browser has ${got.length} of the 3 standees: ${JSON.stringify(got)}`);
      // The texture budget: a figure's texture is at most 160 KB; these are well under.
      if (got.some((x) => x.bytes > 160_000 || x.triangles > 12_000))
        throw new Error(`over budget: ${JSON.stringify(got)}`);
      if (d === host) console.log("  standees:", JSON.stringify(got));
    }
    if (process.env.SMOKE_SHOTS) {
      await host.page.screenshot({ path: join(process.env.SMOKE_SHOTS, "standees-host.png") });
      await guest.page.screenshot({ path: join(process.env.SMOKE_SHOTS, "standees-guest.png") });
      // The army showcase at the start of the battle comes in close on them.
      await host.page.getByRole("button", { name: /Start battle/ }).click();
      const anyway = host.page.getByRole("button", { name: /Start anyway/ });
      if (await anyway.count()) await anyway.first().click();
      for (let i = 0; i < 6; i++) {
        await host.page.waitForTimeout(1500);
        await host.page.screenshot({ path: join(process.env.SMOKE_SHOTS, `standees-showcase-${i}.png`) });
      }
    }
    await host.context.close();
    await guest.context.close();
    return [...host.page.errors, ...guest.page.errors];
  },

  /**
   * Match figures from a photo: a player's OpenAI key (kept on the device), a photo of their army,
   * and the model's answer (stood in for here, at OpenAI's address) lands in the import's Figure column.
   */
  async "photo-match"() {
    const { page, context } = await device();
    // Cubes as binary STLs: two named so they match no unit by name.
    const stl = (size) => {
      const tris = [
        [
          [0, 0, 0],
          [1, 1, 0],
          [1, 0, 0],
        ],
        [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ],
        [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
        ],
        [
          [0, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
        ],
        [
          [0, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
        [
          [0, 1, 0],
          [1, 1, 1],
          [1, 1, 0],
        ],
        [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 1],
        ],
        [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
        ],
        [
          [0, 0, 0],
          [0, 1, 1],
          [0, 1, 0],
        ],
        [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
        ],
        [
          [1, 0, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
      ];
      const b = Buffer.alloc(84 + 50 * tris.length);
      b.writeUInt32LE(tris.length, 80);
      tris.forEach((t, i) => t.flat().forEach((v, j) => b.writeFloatLE(v * size, 84 + i * 50 + 12 + j * 4)));
      return b;
    };
    await lobby(page);
    await page.getByRole("button", { name: /^Figure library/ }).click();
    await page
      .locator('input[type="file"][multiple]')
      .first()
      .setInputFiles([
        { name: "mini alpha.stl", mimeType: "model/stl", buffer: stl(25) },
        { name: "mini beta.stl", mimeType: "model/stl", buffer: stl(32) },
        // Named for a unit, as TTS figures mostly are: name matching dresses that unit, not the photo.
        { name: "Field Marshal.stl", mimeType: "model/stl", buffer: stl(40) },
      ]);
    await page.getByText("mini beta").first().waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.locator("summary", { hasText: "More ways to play" }).click();
    await page.getByRole("button", { name: /hotseat/ }).click();
    await page.getByRole("button", { name: "Sample army" }).click();
    const modal = page.locator(".modal");
    await modal.getByRole("button", { name: /Match figures from a photo/ }).click();
    await modal.getByLabel("OpenAI API key").fill("sk-smoke");
    await modal.getByRole("button", { name: "Keep the key" }).click();
    const stored = await page.evaluate(() => localStorage.getItem("open-battle:vision"));
    if (!stored?.includes("sk-smoke")) throw new Error(`the key wasn't kept: ${stored}`);
    let sent = null;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      sent = route.request().postDataJSON();
      const figure = sent.input[0].content.find(
        (c) => c.type === "input_text" && c.text.startsWith("F") && c.text.includes("mini beta"),
      );
      const answer = {
        assignments: [{ unit: "U1", figure: figure.text.split(":")[0], confidence: 0.82, why: "same pose" }],
      };
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
        }),
      });
    });
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 2400;
      c.height = 1800;
      const g = c.getContext("2d");
      g.fillStyle = "#ddd";
      g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = "#335";
      for (let i = 0; i < 5; i++) g.fillRect(300 + i * 350, 700, 160, 500);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const input = document.querySelector(".photo-match input[type=file]");
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "army.jpg", { type: "image/jpeg" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await modal.getByRole("button", { name: "Match", exact: true }).click();
    await modal.getByText(/The photo matched 1 unit/).waitFor({ timeout: 30_000 });
    if (sent.input[0].content[0].text.includes("Field Marshal"))
      throw new Error("the photo was asked about a unit its name already matched");
    const images = sent.input[0].content.filter((c) => c.type === "input_image");
    if (sent.model !== "gpt-5" || images.length < 1 || !images[0].image_url.startsWith("data:image/jpeg"))
      throw new Error(`odd request: model ${sent.model}, ${images.length} images`);
    const pick = modal.locator(".figure-pick select").first();
    const label = await pick.evaluate((s) => s.selectedOptions[0]?.textContent);
    if (label !== "mini beta" || !(await pick.getAttribute("class"))?.includes("from-photo"))
      throw new Error(`the first unit has ${label}`);
    console.log(`  photo-match: ${images.length} images sent, first unit picked ${label}`);
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "photo-match.png") });
    await context.close();
    return page.errors;
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

  /**
   * A game at phone width (UX 17, 152–154): nothing wider than the screen, and every control
   * (☰ Menu, the stratagems tab, the replay bar) on it, with a unit's sheet open too.
   */
  async "phone-table"() {
    const { page, context } = await device({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").tap();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    const offScreen = () =>
      page.evaluate(() => {
        const W = innerWidth;
        const H = innerHeight;
        const out = [...document.querySelectorAll("button, summary, [role=tab]")].flatMap((e) => {
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height || e.closest("details:not([open]) > :not(summary)")) return [];
          return r.right > W + 1 || r.bottom > H + 1 || r.left < -1
            ? [`${(e.textContent ?? "").trim().slice(0, 24)} at ${Math.round(r.left)},${Math.round(r.top)}`]
            : [];
        });
        const wide = document.documentElement.scrollWidth;
        return wide > W ? [`page ${wide}px wide`, ...out] : out;
      });
    const off = await offScreen();
    if (off.length) throw new Error(`off screen: ${off.join("; ")}`);
    await page.getByRole("button", { name: /Menu/ }).first().tap();
    await page.keyboard.press("Escape");
    await page.keyboard.press("]");
    await page.locator(".panel.unitcard").waitFor();
    const sheet = await page.locator(".panel.unitcard").boundingBox();
    if (!sheet || sheet.width > 390) throw new Error(`the unit sheet is ${sheet?.width}px wide`);
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  /**
   * A tablet, touch only (#60): a Rift Lanterns game played out with fingers (drag, hold-to-measure, pinch,
   * twist), then a 40k turn (move, shoot by tapping the target, every roll), with 44 px targets in both
   * orientations.
   */
  async "tablet-touch"() {
    const { page, context } = await device(IPAD);
    const t = await touch(page);
    await lobby(page);
    await page
      .locator(".demo.ours", { hasText: "Rift Lanterns" })
      .getByRole("button", { name: "Play now (both sides)" })
      .tap();
    await touchTable(page, t);
    const primary = page.locator(".topbar .turn button.primary");
    const u = await tapOwnUnit(page, t);
    await touchMove(page, t, u, { x: 30, y: -50 });
    if (!/End activation/.test(await primary.textContent()))
      throw new Error("the moved unit didn't start activating");
    // With a unit moved and selected, a finger dragged across empty table still pans, never measures (UX 416).
    const rulers = await page.locator(".ruler").count();
    const rulerText = await page.locator(".ruler").allTextContents();
    const before = await page.locator(".plate [data-unit]").first().boundingBox();
    await t.drag({ x: 560, y: 480 }, { x: 460, y: 440 }, { stepMs: 30 });
    await sleep(800);
    const after = await page.locator(".plate [data-unit]").first().boundingBox();
    if ((await page.locator(".ruler").count()) > rulers)
      throw new Error(
        `a drag on empty table measured instead of panning: ${rulerText} -> ${await page.locator(".ruler").allTextContents()}`,
      );
    if (Math.hypot(after.x - before.x, after.y - before.y) < 20) {
      if (process.env.SMOKE_SHOTS)
        await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "touch-pan.png") });
      throw new Error(`a drag on empty table didn't pan (${JSON.stringify([before, after])})`);
    }
    await t.drag({ x: 640, y: 420 }, { x: 760, y: 360 }, { hold: 700 });
    await page
      .locator(".ruler")
      .first()
      .waitFor({ timeout: 3000 })
      .catch(() => {
        throw new Error("holding then dragging showed no ruler");
      });
    const plate = () => page.locator(".plate [data-unit]").first().boundingBox();
    const p0 = await plate();
    await t.two({ x: 640, y: 440 }, { d0: 120, d1: 240 });
    await sleep(600);
    const p1 = await plate();
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 5) throw new Error("a pinch didn't zoom");
    const off = await smallTargets(page);
    if (off.length) throw new Error(`small or off screen at 1180×820: ${off.slice(0, 4).join("; ")}`);
    for (let i = 0; i < 80; i++) {
      if (/Battle over/.test(await page.locator(".topbar .turn strong").textContent())) break;
      if (!(await primary.isEnabled()))
        throw new Error(`stuck at ${await page.locator(".topbar .turn strong").textContent()}`);
      await primary.tap();
      await sleep(200);
    }
    if (!/Battle over/.test(await page.locator(".topbar .turn strong").textContent()))
      throw new Error("the Rift Lanterns game didn't finish");

    await lobby(page);
    await page
      .locator(".demos .demo", { hasText: "Sci-fi battle" })
      .getByRole("button", { name: "Try (both sides)" })
      .tap();
    // The 3D view first (where most play happens): a twist must work there (PX re-check of #60).
    await touchTable(page, t, false);
    const next = page.locator(".topbar .turn button", { hasText: "▶" });
    const phase = () => page.locator(".topbar .turn .phases .current").textContent();
    await next.tap();
    await sleep(1000);
    if ((await phase()) !== "Movement") throw new Error(`▶ went to ${await phase()}, not Movement`);
    const mover = await tapOwnUnit(page, t);
    // Two fingers twisted on the selected unit turn it (PX touch pass): its models move, so the card's move counts.
    const moved = async () =>
      Number((await page.locator(".unitcard").first().innerText()).match(/Moved ([\d.]+)/)?.[1] ?? NaN);
    if ((await moved()) !== 0) throw new Error("the unit had moved before the twist");
    await t.two({ x: mover.x, y: mover.y }, { d0: 50, d1: 50, a0: 0, a1: 0.6, stagger: 60 });
    await sleep(1500);
    if (!((await moved()) > 0)) throw new Error("a two-finger twist on the selected unit didn't turn it");
    // Top-down from here; turned, its models stand elsewhere: find one again to drag.
    await topDown(page, t);
    await touchMove(page, t, await tapOwnUnit(page, t), { x: 0, y: -40 });
    await next.tap();
    await sleep(1500);
    await page
      .locator(".unitcard button", { hasText: /^Shoot$/ })
      .first()
      .tap();
    await page.getByText("Tap an enemy unit, or pick one from the list").waitFor();
    // An enemy unit in range (from the attack's own target list): its plate, tapped until the attack has a target.
    const inRange = (await page.locator(".attack option").allTextContents())
      .filter((o) => /\(\d/.test(o) && !o.includes("out of range"))
      .map((o) => o.replace(/ \(.*$/, ""));
    const enemies = await page.locator(".plate [data-unit]").evaluateAll(
      (els, names) =>
        els
          .filter((e) => names.some((n) => e.textContent.includes(n)))
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }),
      inRange,
    );
    const declare = page.locator(".attack button", { hasText: "Declare attack" });
    for (const e of enemies) {
      for (const [dx, dy] of [
        [0, 10],
        [0, -10],
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 18],
      ]) {
        if (await declare.count()) break;
        // While picking, a tap never selects another unit or drops the attack (UX 417).
        if (!(await page.locator(".attack").count()))
          throw new Error("a tap while picking a target dropped the attack");
        await t.tap(e.x + dx, e.y + dy);
        await sleep(500);
        if (await page.locator(".touch-menu").count()) await page.locator(".touch-menu-scrim").tap();
      }
      if (await declare.count()) break;
    }
    if (!(await declare.count())) {
      if (process.env.SMOKE_SHOTS)
        await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "touch-target.png") });
      throw new Error(
        `tapping enemy models (${inRange.join(", ")}: ${enemies.length} plates) picked no target`,
      );
    }
    await declare.tap();
    for (let i = 0; i < 10; i++) {
      const roll = page.locator(".attack button.primary, .procedure button.primary").first();
      if (!(await roll.count())) break;
      await roll.tap();
      await sleep(2500);
    }
    await page.locator(".attack button, .procedure button", { hasText: "Done" }).first().tap();
    for (let i = 0; i < 8 && /Player 1/.test(await page.locator(".topbar .turn strong").textContent()); i++) {
      await next.tap();
      await sleep(800);
    }
    if (!/Player 2/.test(await page.locator(".topbar .turn strong").textContent()))
      throw new Error("▶ never reached the other player's turn");
    await page.setViewportSize({ width: 820, height: 1180 });
    await sleep(1500);
    const portrait = await smallTargets(page);
    if (portrait.length)
      throw new Error(`small or off screen at 820×1180: ${portrait.slice(0, 4).join("; ")}`);
    await context.close();
    return page.errors;
  },

  async replay() {
    const path = join(files, "replay.json");
    if (!existsSync(path)) throw new Error("no replay saved (the hotseat check makes it)");
    const { page, context } = await device();
    await lobby(page);
    await page.locator("label.file", { hasText: "Open a replay file" }).locator("input").setInputFiles(path);
    await page.locator(".replaybar").waitFor();
    await context.close();
    return page.errors;
  },

  async campaign() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator("summary", { hasText: "More ways to play" }).click();
    await page.getByRole("button", { name: /hotseat/ }).click();
    // Starting a campaign lives in Game settings until one is attached (UX 83).
    await page.locator("details.settings > summary").click();
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

  async "tts-table"() {
    const { page, context } = await device();
    // A box OBJ: `w` × `h` × `d`, its footprint centred `dx` along x from the file's origin.
    const box = (w, h, d, dx = 0) => {
      const v = [];
      for (const y of [0, h])
        for (const z of [-d / 2, d / 2]) for (const x of [-w / 2, w / 2]) v.push(`v ${x + dx} ${y} ${z}`);
      const f = ["1 2 4 3", "5 7 8 6", "1 5 6 2", "3 4 8 7", "1 3 7 5", "2 6 8 4"].map((q) => `f ${q}`);
      return [...v, ...f].join("\n") + "\n";
    };
    const meshes = {
      "https://example.com/boy.obj": box(1.2, 1.6, 1.2),
      "https://example.com/warden.obj": box(1.25, 1.8, 1.25),
      "https://example.com/ruin.obj": box(6, 4, 1, 2),
    };
    await context.route("https://example.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        headers: { "access-control-allow-origin": "*" },
        body: meshes[route.request().url()] ?? "",
      }),
    );
    const fig = (nickname, x, z, rotY, mesh) => ({
      Name: "Custom_Model",
      Nickname: nickname,
      Transform: { posX: x, posY: 1, posZ: z, rotY, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomMesh: { MeshURL: mesh, TypeIndex: 1 },
    });
    const save = {
      SaveName: "Smoke Table",
      ObjectStates: [
        fig("Scrap Brute", -10, -15, 0, "https://example.com/boy.obj"),
        fig("Scrap Brute", -8, -15, 0, "https://example.com/boy.obj"),
        fig("Warden", 4, 15, 180, "https://example.com/warden.obj"),
        fig("Warden", 6, 15, 180, "https://example.com/warden.obj"),
        { ...fig("Ruined wall", 0, 0, 90, "https://example.com/ruin.obj"), Locked: true },
      ],
    };
    const path = join(files, "tts-save.json");
    writeFileSync(path, JSON.stringify(save));
    await lobby(page);
    await page.getByRole("button", { name: "Open a Tabletop Simulator save as a game" }).click();
    await page.locator(".tts-import").waitFor();
    await page
      .locator(".tts-import label", { hasText: "Open a save file" })
      .locator("input")
      .setInputFiles(path);
    const whole = page.locator(".tts-table");
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-1.png") });
    await whole.getByText("1 piece of terrain, 2 units on the table, 2 armies").waitFor();
    await whole.getByRole("button", { name: "Open it as a game" }).click();
    await page.locator(".topbar").waitFor({ timeout: 30_000 });
    // The production build keeps its state to itself: read what was saved to the table library and shelf.
    const got = await page.waitForFunction(
      async () => {
        const all = (db, store) =>
          new Promise((resolve) => {
            const req = indexedDB.open(db);
            req.onsuccess = () => {
              try {
                const q = req.result.transaction(store).objectStore(store).getAll();
                q.onsuccess = () => resolve(q.result);
                q.onerror = () => resolve([]);
              } catch {
                resolve([]);
              }
            };
            req.onerror = () => resolve([]);
          });
        const tables = await all("open-battle-tables", "tables");
        const armies = await all("open-battle-shelf", "armies");
        const tb = tables.find((x) => x.name === "Smoke Table");
        if (!tb || armies.length < 2) return null;
        return {
          terrain: tb.layout.terrain.map((p) => [
            p.name,
            Math.round(p.position.x * 10) / 10,
            Math.round(p.position.y * 10) / 10,
          ]),
          models: armies
            .flatMap((a) =>
              a.roster.units.flatMap((u) =>
                u.models.map((m) => [m.profile.name, m.at.x, m.at.y, Math.round(m.at.facing * 100) / 100]),
              ),
            )
            .sort(),
          table: tb.name,
        };
      },
      null,
      { timeout: 30_000 },
    );
    const { terrain, models, table } = await got.jsonValue();
    const want = JSON.stringify({
      terrain: [["Ruined wall", 0, -2]],
      models: [
        ["Warden", 4, -15, 0],
        ["Warden", 6, -15, 0],
        ["Scrap Brute", -10, 15, 3.14],
        ["Scrap Brute", -8, 15, 3.14],
      ],
      table: "Smoke Table",
    });
    if (JSON.stringify({ terrain, models, table }) !== want)
      throw new Error(`table came in as ${JSON.stringify({ terrain, models, table })}`);
    // And the game opened on it, both armies on the table in their figures.
    await page.locator("option:checked", { hasText: "Smoke Table" }).first().waitFor({ state: "attached" });
    await page.locator(".plate", { hasText: "Scrap Brute" }).first().waitFor();
    await page.locator(".plate", { hasText: "Warden" }).first().waitFor();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-2.png") });
    await context.close();
    return page.errors;
  },

  async "tts-short-edges"() {
    // UX 473–476: armies on the short edges, a bag of reserves, a model whose file is gone, Swap, no stats.
    const { page, context } = await device();
    const box = "v -0.6 0 -0.6\nv 0.6 0 -0.6\nv 0.6 1.6 0.6\nv -0.6 1.6 0.6\nf 1 2 3 4\n";
    await context.route("https://example.com/**", (route) =>
      route.request().url().endsWith("gone.obj")
        ? route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" })
        : route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: box }),
    );
    const fig = (nickname, x, z, mesh = "https://example.com/fig.obj") => ({
      Name: "Custom_Model",
      Nickname: nickname,
      Transform: { posX: x, posY: 1, posZ: z, rotY: 90, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomMesh: { MeshURL: mesh, TypeIndex: 1 },
    });
    const save = {
      SaveName: "Hammer and Anvil",
      ObjectStates: [
        fig("Scrap Brute", -26, -1),
        fig("Scrap Brute", -26, 1),
        fig("Broken Thing", -24, 6, "https://example.com/gone.obj"),
        fig("Warden", 26, 0),
        fig("Warden", 26, 2),
        {
          Name: "Bag",
          Nickname: "Reserves",
          Transform: { posX: 28, posZ: 18 },
          ContainedObjects: [fig("Hellblaster", 0, 0)],
        },
      ],
    };
    const path = join(files, "tts-short.json");
    writeFileSync(path, JSON.stringify(save));
    await lobby(page);
    await page.getByRole("button", { name: "Open a Tabletop Simulator save as a game" }).click();
    await page
      .locator(".tts-import label", { hasText: "Open a save file" })
      .locator("input")
      .setInputFiles(path);
    const sides = page.locator(".tts-sides");
    const line = async (n) => (await sides.locator(".row").nth(n).innerText()).replace(/\s+/g, " ");
    await sides.waitFor();
    const before = [await line(0), await line(1)];
    if (
      !/Player 1:.*Scrap Brute.*Broken Thing/.test(before[0]) ||
      !/Player 2:.*Warden.*Reserves \(in a bag\)/.test(before[1])
    )
      throw new Error(`split as ${before.join(" | ")}`);
    await sides.getByRole("button", { name: "Swap sides" }).click();
    if (!/Player 1:.*Warden/.test(await line(0))) throw new Error("Swap sides didn't swap");
    await page.locator(".tts-table").getByRole("button", { name: "Open it as a game" }).click();
    // The library closes on the game, and what it couldn't bring is said there (UX 478).
    await page
      .locator(".tts-note", { hasText: "Broken Thing couldn't be downloaded or read" })
      .waitFor({ timeout: 30_000 });
    if (await page.locator(".tts-import").isVisible())
      throw new Error("the figure library stayed open over the game");
    await page.locator(".tts-note").getByRole("button", { name: "Close" }).click();
    await page.locator(".plate", { hasText: "Broken Thing" }).first().waitFor({ timeout: 30_000 });
    await page.locator(".plate", { hasText: "Warden" }).first().waitFor();
    // Player 1 (blue, the swapped Wardens) stand where TTS had them, on the right.
    await page.keyboard.press("]");
    await page.locator(".panel.unitcard .no-stats").waitFor();
    await context.close();
    return page.errors;
  },

  /**
   * TTS reflexes (PX): Tab lands on the table first; the ? sheet's TTS block switches on TTS controls; then
   * a left drag on the table picks units with a box, D slides the camera and Delete takes a model off.
   */
  async "tts-controls"() {
    const { page, context } = await device();
    await lobby(page);
    await page.locator(".demos .demo", { hasText: "Sci-fi battle" }).locator(".try").click();
    await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.classList.contains("showcase"), null, { timeout: 30000 });
    await page.keyboard.press("Escape");
    const focused = () => page.evaluate(() => document.activeElement?.tagName);
    if ((await focused()) !== "CANVAS")
      throw new Error(`the game opened with ${await focused()} focused, not the table`);
    await page.keyboard.press("?");
    await page.getByText("Coming from Tabletop Simulator?").waitFor();
    await page.getByLabel("TTS controls (just on this device)").check();
    await page.keyboard.press("Escape");
    await sleep(500);
    // With TTS controls, Tab on the table measures (while held) rather than going to the score steppers.
    await page.locator("canvas").first().focus();
    await page.keyboard.down("Tab");
    await sleep(200);
    if ((await focused()) !== "CANVAS") throw new Error(`Tab went to ${await focused()}, not measuring`);
    await page.keyboard.up("Tab");
    // A left drag from empty table draws a box: tried from a few spots, as a model may stand on one.
    const { width: w, height: h } = page.viewportSize();
    let boxed = false;
    for (const [x, y] of [
      [0.42, 0.85],
      [0.3, 0.8],
      [0.55, 0.88],
      [0.35, 0.62],
    ]) {
      await page.mouse.move(w * x, h * y);
      await page.mouse.down();
      await page.mouse.move(w * x + 30, h * y - 30, { steps: 4 });
      boxed = (await page.locator(".touch-box").count()) > 0;
      if (boxed) {
        await page.mouse.move(w * 0.98, h * 0.12, { steps: 10 });
        await page.mouse.up();
        break;
      }
      await page.mouse.up();
      await page.keyboard.press("Escape");
    }
    if (!boxed) throw new Error("a left drag on the table drew no box");
    await page.locator(".touch-tools", { hasText: "units picked" }).waitFor({ timeout: 3000 });
    await page.keyboard.press("Escape");
    // D slides the camera: the plates move across the screen.
    const plate = page.locator(".plate [data-unit]").first();
    const p0 = await plate.boundingBox();
    await page.mouse.move(w / 2, 10);
    await page.keyboard.down("d");
    await sleep(700);
    await page.keyboard.up("d");
    await sleep(300);
    const p1 = await plate.boundingBox();
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 20) throw new Error("holding D didn't slide the camera");
    // Delete, with a unit selected and nothing under the pointer: its last model goes, after asking.
    await page.keyboard.press("]");
    await page.locator(".unitcard").first().waitFor();
    const dead = () => page.locator(".unitcard li.dead").count();
    const before = await dead();
    await page.keyboard.press("Delete");
    await sleep(800);
    if ((await dead()) !== before + 1)
      throw new Error(`Delete took ${(await dead()) - before} models off, not 1`);
    if (page.errors.length) throw new Error(page.errors[0]);
    await context.close();
  },

  async "tts-board-turn"() {
    // UX 477: a board long along TTS z, armies on its short edges. The table turns; the armies keep their places.
    const { page, context } = await device();
    const box = (w, h, d) => {
      const v = [];
      for (const y of [0, h])
        for (const z of [-d / 2, d / 2]) for (const x of [-w / 2, w / 2]) v.push(`v ${x} ${y} ${z}`);
      const f = ["1 2 4 3", "5 7 8 6", "1 5 6 2", "3 4 8 7", "1 3 7 5", "2 6 8 4"].map((q) => `f ${q}`);
      return [...v, ...f].join("\n") + "\n";
    };
    const meshes = {
      "https://example.com/board.obj": box(44, 0.2, 60),
      "https://example.com/fig.obj": box(1, 1.5, 1),
    };
    await context.route("https://example.com/**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        body: meshes[route.request().url()] ?? "",
      }),
    );
    const fig = (nickname, x, z, rotY) => ({
      Name: "Custom_Model",
      Nickname: nickname,
      Transform: { posX: x, posY: 1, posZ: z, rotY, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomMesh: { MeshURL: "https://example.com/fig.obj", TypeIndex: 1 },
    });
    const save = {
      SaveName: "Long Board",
      ObjectStates: [
        {
          Name: "Custom_Model",
          Nickname: "Board",
          Locked: true,
          Transform: { posX: 0, posY: 0, posZ: 0, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          CustomMesh: { MeshURL: "https://example.com/board.obj", TypeIndex: 4 },
        },
        // Both off centre along the long edges, as tt5 had them: Ember Kin wholly on one half.
        ...[0, 1, 2, 3, 4].map((i) => fig("Ember Kin", -8 + i * 1.5, -20, 0)),
        ...[0, 1, 2, 3, 4, 5].map((i) => fig("Scrap Brute", -6 + i * 1.5, 20, 180)),
      ],
    };
    const path = join(files, "tts-board.json");
    writeFileSync(path, JSON.stringify(save));
    await lobby(page);
    await page.getByRole("button", { name: "Open a Tabletop Simulator save as a game" }).click();
    await page
      .locator(".tts-import label", { hasText: "Open a save file" })
      .locator("input")
      .setInputFiles(path);
    await page.locator(".tts-table").getByRole("button", { name: "Open it as a game" }).click();
    await page.locator(".plate", { hasText: "Ember Kin" }).first().waitFor({ timeout: 30_000 });
    await page.locator(".plate", { hasText: "Scrap Brute" }).first().waitFor();
    await page.waitForTimeout(500);
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-board.png") });
    // Each army stays together on its own short edge: on screen, one wholly left of the other.
    const xs = async (name) =>
      page.locator(".plate", { hasText: name }).evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return r.x + r.width / 2;
        }),
      );
    const ember = await xs("Ember Kin");
    const scrappers = await xs("Scrap Brute");
    const apart =
      Math.max(...ember) + 40 < Math.min(...scrappers) || Math.max(...scrappers) + 40 < Math.min(...ember);
    if (!apart)
      throw new Error(
        `armies overlap: Ember ${ember.map(Math.round)}, Scrappers ${scrappers.map(Math.round)}`,
      );
    if (await page.getByText("Engaged").count()) throw new Error("units start the game engaged");
    await context.close();
    return page.errors;
  },

  async "tts-cards"() {
    // #75: a save's mission deck comes with its table; a player draws, shows, discards and shuffles back.
    const { page, context } = await device();
    const box = (w, h, d) => {
      const v = [];
      for (const y of [0, h])
        for (const z of [-d / 2, d / 2]) for (const x of [-w / 2, w / 2]) v.push(`v ${x} ${y} ${z}`);
      const f = ["1 2 4 3", "5 7 8 6", "1 5 6 2", "3 4 8 7", "1 3 7 5", "2 6 8 4"].map((q) => `f ${q}`);
      return [...v, ...f].join("\n") + "\n";
    };
    // Three cards side by side on one sheet, each 63 × 88.
    const cells = ["#c33", "#3c3", "#33c"]
      .map((c, i) => `<rect x="${i * 63}" y="0" width="63" height="88" fill="${c}"/>`)
      .join("");
    const served = {
      "https://example.com/fig.obj": ["text/plain", box(1, 1.5, 1)],
      "https://example.com/cards.svg": [
        "image/svg+xml",
        `<svg xmlns="http://www.w3.org/2000/svg" width="189" height="88">${cells}</svg>`,
      ],
    };
    await context.route("https://example.com/**", (route) => {
      const [type, body] = served[route.request().url()] ?? ["text/plain", ""];
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": type },
        body,
      });
    });
    const fig = (nickname, x, z) => ({
      Name: "Custom_Model",
      Nickname: nickname,
      Transform: { posX: x, posY: 1, posZ: z, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomMesh: { MeshURL: "https://example.com/fig.obj", TypeIndex: 1 },
    });
    const sheet = {
      7: {
        FaceURL: "https://example.com/cards.svg",
        BackURL: "https://example.com/cards.svg",
        NumWidth: 3,
        NumHeight: 1,
      },
    };
    const deck = {
      Name: "Deck",
      Nickname: "Secondary Missions",
      CustomDeck: sheet,
      ContainedObjects: ["Assassination", "Engage", "Area Denial"].map((n, i) => ({
        Name: "Card",
        Nickname: n,
        CardID: 700 + i,
        CustomDeck: sheet,
      })),
    };
    const save = {
      SaveName: "Mission Pack",
      ObjectStates: [
        ...[0, 1, 2].map((i) => fig("Ember Kin", -2 + i * 1.5, -18)),
        ...[0, 1, 2].map((i) => fig("Scrap Brute", -2 + i * 1.5, 18)),
        deck,
        { Name: "Bag", Nickname: "Player 2 cards", ContainedObjects: [deck] },
      ],
    };
    const path = join(files, "tts-cards.json");
    writeFileSync(path, JSON.stringify(save));
    await lobby(page);
    await page.getByRole("button", { name: "Open a Tabletop Simulator save as a game" }).click();
    await page
      .locator(".tts-import label", { hasText: "Open a save file" })
      .locator("input")
      .setInputFiles(path);
    await page.locator(".tts-table", { hasText: "1 deck of cards" }).waitFor();
    await page.locator(".tts-table").getByRole("button", { name: "Open it as a game" }).click();
    const cards = page.locator(".card-decks");
    await cards.waitFor({ timeout: 30_000 });
    await cards.locator("summary").click();
    await cards.getByText("Secondary Missions").waitFor();
    await cards.getByText("3 left to draw").first().waitFor();
    await cards.getByRole("button", { name: "Draw a card" }).first().click();
    const hand = cards.locator(".hand li");
    await hand.first().waitFor();
    if ((await hand.count()) !== 1) throw new Error(`${await hand.count()} cards in hand after one draw`);
    const bg = await hand
      .first()
      .locator(".card-pic")
      .evaluate((e) => getComputedStyle(e).backgroundImage);
    if (!bg.includes("cards.svg")) throw new Error(`the card shows ${bg}, not its sheet`);
    await cards.getByText("2 left to draw").first().waitFor();
    await hand.first().locator(".card-pic").click();
    await page.locator(".card-big").waitFor();
    await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await hand.first().getByRole("button", { name: "Show" }).click();
    await cards.locator(".hand li.shown").waitFor();
    await hand.first().getByRole("button", { name: "Discard" }).click();
    await cards.getByText("1 discarded").first().waitFor();
    await cards.getByRole("button", { name: "Shuffle discards back" }).first().click();
    await cards.getByText("3 left to draw").first().waitFor();
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-cards.png") });
    await context.close();
    return page.errors;
  },

  async "tts-online"() {
    // UX 479–483: a TTS save played online. Player 1's army stands where it stood, the guest is offered theirs,
    // and both armies sit on their own short edges for both players.
    const host = await device();
    const guest = await device();
    const box = (w, h, d) => {
      const v = [];
      for (const y of [0, h])
        for (const z of [-d / 2, d / 2]) for (const x of [-w / 2, w / 2]) v.push(`v ${x} ${y} ${z}`);
      const f = ["1 2 4 3", "5 7 8 6", "1 5 6 2", "3 4 8 7", "1 3 7 5", "2 6 8 4"].map((q) => `f ${q}`);
      return [...v, ...f].join("\n") + "\n";
    };
    const meshes = {
      "https://example.com/board.obj": box(44, 0.2, 60),
      "https://example.com/fig.obj": box(1, 1.5, 1),
    };
    await host.context.route("https://example.com/**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        body: meshes[route.request().url()] ?? "",
      }),
    );
    const fig = (nickname, x, z, rotY) => ({
      Name: "Custom_Model",
      Nickname: nickname,
      Transform: { posX: x, posY: 1, posZ: z, rotY, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomMesh: { MeshURL: "https://example.com/fig.obj", TypeIndex: 1 },
    });
    const save = {
      SaveName: "Club Night",
      ObjectStates: [
        {
          Name: "Custom_Model",
          Nickname: "Board",
          Locked: true,
          Transform: { posX: 0, posY: 0, posZ: 0, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          CustomMesh: { MeshURL: "https://example.com/board.obj", TypeIndex: 4 },
        },
        ...[0, 1, 2, 3, 4].map((i) => fig("Ember Kin", -8 + i * 1.5, -20, 0)),
        ...[0, 1, 2, 3, 4, 5].map((i) => fig("Scrap Brute", -6 + i * 1.5, 20, 180)),
      ],
    };
    const path = join(files, "tts-online.json");
    writeFileSync(path, JSON.stringify(save));
    await lobby(host.page, `?${SIGNAL}`);
    await host.page.locator(".lobby input").first().fill("Ana");
    await host.page.getByRole("button", { name: "Open a Tabletop Simulator save as a game" }).click();
    await host.page
      .locator(".tts-import label", { hasText: "Open a save file" })
      .locator("input")
      .setInputFiles(path);
    await host.page
      .locator(".tts-table")
      .getByRole("button", { name: "Play it online with a friend" })
      .click();
    await host.page.locator(".tts-note", { hasText: "invite link" }).waitFor({ timeout: 30_000 });
    const link = host.page.url();
    if (!link.includes("room=")) throw new Error(`no room in ${link}`);
    // 479: both armies are on Ana's shelf for this game, named after their units (483).
    const shelf = host.page.locator('select[aria-label="From your shelf"] option');
    await shelf.filter({ hasText: "Ember Kin (Club Night)" }).first().waitFor({ state: "attached" });
    await shelf.filter({ hasText: "Scrap Brute (Club Night)" }).first().waitFor({ state: "attached" });
    const p1 = (await host.page.locator(".plate").first().textContent()) ?? "";
    await guest.page.goto(link);
    const offer = guest.page.locator(".brought-offer");
    await offer.waitFor({ timeout: 30_000 });
    await offer.getByRole("button", { name: "Use this army" }).click();
    for (const { page } of [host, guest]) {
      await page.locator(".plate", { hasText: "Ember Kin" }).first().waitFor({ timeout: 30_000 });
      await page.locator(".plate", { hasText: "Scrap Brute" }).first().waitFor({ timeout: 30_000 });
    }
    await host.page.waitForTimeout(500);
    if (process.env.SMOKE_SHOTS) {
      await host.page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-online-host.png") });
      await guest.page.screenshot({ path: join(process.env.SMOKE_SHOTS, "tts-online-guest.png") });
    }
    // 480: on each screen, one army wholly on one side of the other.
    for (const { page } of [host, guest]) {
      const xs = async (name) =>
        page.locator(".plate", { hasText: name }).evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return r.x + r.width / 2;
          }),
        );
      const a = await xs("Ember Kin");
      const b = await xs("Scrap Brute");
      if (!(Math.max(...a) + 40 < Math.min(...b) || Math.max(...b) + 40 < Math.min(...a)))
        throw new Error(`armies overlap: ${a.map(Math.round)} / ${b.map(Math.round)} (Player 1 had ${p1})`);
    }
    await host.context.close();
    await guest.context.close();
    return [...host.page.errors, ...guest.page.errors];
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

  /**
   * The host server (server/host.mjs): Ana opens a room on it, Ben joins by the link, both put an army
   * down, and the game carries on on the server after Ana's browser closes; the server keeps it on disk.
   */
  async "host-server"() {
    const HOST = 8797;
    const data = mkdtempSync(join(tmpdir(), "open-battle-host-"));
    execFileSync("pnpm", ["build:host"], { stdio: "ignore" });
    const hostd = spawn("node", ["server/host.mjs"], {
      stdio: "pipe",
      detached: true,
      env: { ...process.env, PORT: String(HOST), SIGNAL_URL: `ws://localhost:${RELAY}`, DATA_DIR: data },
    });
    await started(hostd, String(HOST));
    try {
      const q = `?${SIGNAL}&hostServer=${encodeURIComponent(`http://localhost:${HOST}`)}`;
      const ana = await device();
      const ben = await device();
      await lobby(ana.page, q);
      await ana.page.locator(".lobby label", { hasText: "Your name" }).locator("input").fill("Ana");
      await ana.page.getByRole("button", { name: "Host on this site's server" }).click();
      await ana.page
        .locator(".room", { hasText: "hosted by this site's server" })
        .waitFor({ timeout: 30_000 });
      await ana.page.locator(".room .people li", { hasText: "Ana" }).waitFor({ timeout: 30_000 });
      const invite = ana.page.url();
      await ben.page.goto(BASE);
      await ben.page.evaluate(() => localStorage.setItem("open-battle:name", "Ben"));
      await ben.page.goto(invite);
      for (const { page } of [ana, ben])
        await page.locator(".room .people li", { hasText: "Ben" }).waitFor({ timeout: 30_000 });
      // Each puts a sample army down: the server resolves both players' moves.
      for (const { page } of [ana, ben]) {
        const pick = page.locator('.panel.hud select[aria-label="Sample army"]');
        if (await pick.count()) await pick.selectOption({ index: 1 });
        else
          await page.locator(".panel.hud").getByRole("button", { name: "Sample army", exact: true }).click();
        const deploy = page.getByRole("button", { name: /^Deploy for/ }).first();
        await deploy.click({ timeout: 15_000 });
        await deploy.waitFor({ state: "detached" });
      }
      const room = new URL(invite).searchParams.get("room");
      await ana.context.close();
      // Ana's gone, and the server still hosts: Ben's table says so, and it isn't choosing a new host.
      await sleep(3000);
      await ben.page.locator(".room", { hasText: "hosted by this site's server" }).waitFor({ timeout: 5000 });
      const info = await (await fetch(`http://localhost:${HOST}/rooms/${room}`)).json();
      if (!info.hosted) throw new Error("the server doesn't host the room");
      await ben.context.close();
      process.kill(-hostd.pid, "SIGTERM");
      await sleep(1000);
      const kept = JSON.parse(readFileSync(join(data, `${room}.json`), "utf8"));
      const by = new Set(kept.events.map((e) => e.by));
      if (by.size < 2) throw new Error(`the kept game has events from ${by.size} player(s)`);
      return [...ana.page.errors, ...ben.page.errors];
    } finally {
      try {
        process.kill(-hostd.pid);
      } catch {
        // Already stopped.
      }
    }
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
