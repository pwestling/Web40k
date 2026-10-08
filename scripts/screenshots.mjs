// README screenshots (#39), from the production build:
//
//   pnpm build && node scripts/screenshots.mjs
//
// Writes docs/screenshots/{landing,lesson,companion}.png. The line of
// sight, top-down and command stack shots are posed by hand and kept as they are.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 4181;
const BASE = `http://localhost:${PORT}/`;
const OUT = "docs/screenshots";
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("localhost") && resolve()));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM ??
    ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(existsSync),
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

async function page(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await context.newPage();
  p.on("dialog", (d) => void d.accept());
  await p.goto(BASE);
  // Seen: no "new" dot or offline notes in the pictures.
  await p.evaluate(() => localStorage.setItem("open-battle:seen-version", "0.1.0"));
  await p.reload();
  await p.locator(".lobby").waitFor();
  return p;
}

async function sampleArmies(p) {
  for (const who of [0, 1]) {
    const pick = p.getByLabel("Army for");
    if (await pick.count()) await pick.selectOption({ index: who });
    await p.getByRole("button", { name: "Sample army" }).click();
    const deploy = p.getByRole("button", { name: /^Deploy for/ }).first();
    await deploy.click();
    await deploy.waitFor({ state: "detached" });
  }
}

try {
  {
    const p = await page();
    await p.screenshot({ path: `${OUT}/landing.png` });
    await p.context().close();
  }
  {
    const p = await page();
    await p.locator(".demos").first().locator(".demo").first().click();
    await p.locator(".coach").waitFor();
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${OUT}/lesson.png` });
    await p.context().close();
  }
  {
    const p = await page({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await p.getByRole("button", { name: "One phone for both of us" }).click();
    await p.locator(".companion").waitFor();
    await sampleArmies(p);
    await p.getByRole("button", { name: /Start battle/ }).click();
    await p.waitForTimeout(3000);
    await p.getByRole("button", { name: "🎲 Screen dice" }).click();
    await p.locator(".tile").first().click();
    await p.getByRole("button", { name: "Shoot", exact: true }).first().click();
    await p.locator(".table-attack .targets button").first().click();
    await p.getByRole("button", { name: /Declare attack/ }).click();
    await p.locator(".attack-roll").click();
    await p.locator(".dice-entry").waitFor();
    await p.locator(".dice-entry").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/companion.png` });
    await p.context().close();
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
