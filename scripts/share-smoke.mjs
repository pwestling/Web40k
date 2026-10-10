// Two browsers share a table file by torrent through a local tracker and seed
// node (server/seeder.mjs): once with the sharer still open, once privately
// (encrypted) after the sharer has left, so it comes from the seed node.
//   pnpm build && node scripts/share-smoke.mjs
// Set CHROMIUM to a browser binary if Playwright has none of its own.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Server from "bittorrent-tracker/server";
import { createSeeder } from "../server/seeder.mjs";

const tracker = new Server({ udp: false, http: false, ws: true, stats: false });
await new Promise((r) => tracker.listen(8000, "127.0.0.1", r));
const seed = createSeeder({ dataDir: mkdtempSync(join(tmpdir(), "seed-")) });
await new Promise((r) => seed.server.listen(8791, r));
const srv = spawn("npx", ["vite", "preview", "--port", "4181", "--strictPort"], { cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 4000));
const NET = `trackers=${encodeURIComponent("ws://127.0.0.1:8000")}&seeders=${encodeURIComponent(process.env.NOSEED ? "http://127.0.0.1:9/seed" : "http://127.0.0.1:8791/seed")}`;
const file = join(mkdtempSync(join(tmpdir(), "tbl-")), "ridge.table.json");
writeFileSync(
  file,
  JSON.stringify({
    format: "open-battle/table@1",
    id: "ridge",
    name: "Ridge line",
    savedAt: 1,
    layout: { terrain: [] },
    table: { width: 44, depth: 30 },
  }),
);

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let failed = false;
const run = async (label, privately, closeSharer) => {
  const a = await (await b.newContext()).newPage();
  a.on("pageerror", (e) => console.log("A err", e.message));
  await a.goto(`http://localhost:4181/?${NET}`);
  await a.click("text=Open or share a file by link");
  if (privately) await a.check("text=Private: encrypt it");
  await a.setInputFiles(".open-link input[type=file]", file);
  await a
    .waitForSelector(".open-link .share-link", { timeout: 20000 })
    .catch(async () => console.log(label, "no link", await a.locator(".open-link").textContent()));
  const link = await a.textContent(".open-link .share-link");
  console.log(
    label,
    "share:",
    link.slice(0, 120),
    "|",
    await a.locator(".open-link p.small .muted").first().textContent(),
  );
  if (closeSharer) await a.close();
  const u = new URL(link);
  const target = `http://localhost:4181/?open=${encodeURIComponent(u.searchParams.get("open"))}&${NET}${u.hash}`;
  const c = await (await b.newContext()).newPage();
  c.on("pageerror", (e) => console.log("C err", e.message));
  await c.goto(target);
  try {
    await c.waitForSelector("[role=dialog]", { timeout: 60000 });
    console.log(label, "dialog:", (await c.textContent("[role=dialog]")).slice(0, 200));
    await c.click("[role=dialog] button.primary");
    await c.waitForTimeout(3000);
    console.log(label, "notes:", await c.locator(".open-link .muted.small").allTextContents());
    console.log(label, "url after:", c.url());
  } catch (e) {
    failed = true;
    console.log(
      label,
      "FAILED",
      await c
        .locator(".open-link")
        .textContent()
        .catch(() => ""),
    );
  }
};
await run("public+live:", false, false);
await run("private+sharer gone:", true, true);
await b.close();
srv.kill();
tracker.close();
seed.server.close();
process.exit(failed ? 1 : 0);
