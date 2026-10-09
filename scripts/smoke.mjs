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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An iPad (#60): touch only, so the app sees fingers, not a mouse. */
const IPAD = { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true };

/** On a tablet, by touch: past the showcase, then the top-down view from the table's long-press menu. */
async function touchTable(page, t) {
  await page.locator(".topbar").getByText("Round 1").waitFor({ timeout: 30000 });
  for (let i = 0; i < 60 && (await page.evaluate(() => document.body.classList.contains("showcase"))); i++) {
    await t.tap(600, 420);
    await sleep(400);
  }
  await sleep(1500);
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
    await page.getByRole("button", { name: "Download replay" }).click();
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
      .getByText(/no charge possible|Roll charge/)
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
    await page.getByRole("button", { name: "Play now (both sides)" }).tap();
    await touchTable(page, t);
    const primary = page.locator(".topbar .turn button.primary");
    const u = await tapOwnUnit(page, t);
    await touchMove(page, t, u, { x: 30, y: -50 });
    if (!/End activation/.test(await primary.textContent()))
      throw new Error("the moved unit didn't start activating");
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
    await touchTable(page, t);
    const next = page.locator(".topbar .turn button", { hasText: "▶" });
    const phase = () => page.locator(".topbar .turn .phases .current").textContent();
    await next.tap();
    await sleep(1000);
    if ((await phase()) !== "Movement") throw new Error(`▶ went to ${await phase()}, not Movement`);
    const mover = await tapOwnUnit(page, t);
    await touchMove(page, t, mover, { x: 0, y: -40 });
    await next.tap();
    await sleep(1500);
    await page
      .locator(".unitcard button", { hasText: /^Shoot$/ })
      .first()
      .tap();
    await page.getByText("Tap a target on the table…").waitFor();
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
        // A tap that missed picks whatever was there instead: the shooter's card back, then Shoot again.
        if (!(await page.locator(".attack").count())) {
          await tapOwnUnit(page, t);
          await page
            .locator(".unitcard button", { hasText: /^Shoot$/ })
            .first()
            .tap();
          await sleep(800);
        }
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
