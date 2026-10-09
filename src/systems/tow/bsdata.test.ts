import { describe, expect, it } from "vitest";
import { isAutomated, isWeaponRule } from "../../core/content/player";
import { importTowRoster, RULE_GROUP } from "./roster";
import { oldWorld } from "./system";

/**
 * Real input (#66): Old World rosters built from the public community
 * catalogues by `node scripts/bsdata-tow.mjs`, never committed. Runs only
 * with BSDATA_TOW=<folder>, and prints, for each army, how many of its
 * special rules (the units' rules and their weapons' rules, by name) the app
 * plays, and across all of them the commonest it leaves as reminders.
 */
const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BSDATA_TOW;
// The app's own types leave Node out: just what this needs.
interface Fs {
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
}
const fs = dir ? ((await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs) : null;
const files = fs ? fs.readdirSync(dir!).filter((f) => f.endsWith(".ros")) : [];

/** A rule name without its parameter: "Armour Bane (2)" and "Armour Bane (1)" count as one. */
const stem = (n: string) => n.replace(/\s*\(.*\)\s*$/, "").trim();

describe.skipIf(!dir)("real Old World rosters", () => {
  const left = new Map<string, number>();
  let allAuto = 0;
  let allTotal = 0;
  for (const f of files)
    it(f, async () => {
      const r = await importTowRoster(f, fs!.readFileSync(`${dir}/${f}`));
      expect(r.units.length).toBeGreaterThan(0);
      const rules = new Map<string, boolean>();
      for (const u of r.units) {
        for (const a of u.sheet.abilities)
          if (a.group === RULE_GROUP)
            rules.set(
              stem(a.name),
              !!rules.get(stem(a.name)) || isAutomated(oldWorld, a) || isWeaponRule(oldWorld, a),
            );
        for (const w of Object.values(u.sheet.weapons))
          for (const k of w.keywords) {
            const a = { name: k, text: "" };
            rules.set(stem(k), !!rules.get(stem(k)) || isAutomated(oldWorld, a) || isWeaponRule(oldWorld, a));
          }
      }
      const auto = [...rules.values()].filter(Boolean).length;
      allAuto += auto;
      allTotal += rules.size;
      for (const [n, on] of rules) if (!on) left.set(n, (left.get(n) ?? 0) + 1);
      console.log(`${f}: ${r.units.length} units; special rules ${auto} automated of ${rules.size}`);
    });
  it("summary", () => {
    const top = [...left].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log(
      `All armies: ${allAuto} of ${allTotal} special rules automated (per army, by name).\n` +
        `Commonest reminders (armies): ${top.map(([n, c]) => `${n} ${c}`).join(", ")}`,
    );
  });
});
