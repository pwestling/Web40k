import { describe, expect, it } from "vitest";
import { fortyK } from "../../core/content/examples/forty-k";
import { describesWeaponKeyword, isAutomated, isWeaponRule } from "../../core/content/player";
import type { Unit } from "../../core";
import { recognize, recognizeArmyRule, recognizeStratagem } from "./recognize";
import { DETACHMENT_RULE, ENHANCEMENTS, loadRosterParsers, parseRosterText } from "./roster";

/**
 * Real input (#51): rosters built from the public BSData catalogues by
 * `node scripts/bsdata.mjs`, never committed. Runs only with BSDATA=<folder>,
 * and prints what the import reads and automates for each.
 */
const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BSDATA;
// The app's own types leave Node out: just what this needs.
interface Fs {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
}
const fs = dir ? ((await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs) : null;
const files = fs ? fs.readdirSync(dir!).filter((f) => f.endsWith(".ros")) : [];

await loadRosterParsers();

describe.skipIf(!dir)("real rosters from BSData", () => {
  for (const f of files)
    it(f, () => {
      const r = parseRosterText(fs!.readFileSync(`${dir}/${f}`, "utf8"));
      expect(r.units.length).toBeGreaterThan(0);
      let auto = 0;
      let read = 0;
      let total = 0;
      for (const u of r.units) {
        expect(u.models.length, u.name).toBeGreaterThan(0);
        expect(Object.keys(u.sheet.weapons).length, u.name).toBeGreaterThan(0);
        for (const m of u.models)
          for (const k of ["T", "SV", "W"]) expect(m.profile.chars[k], `${u.name} ${k}`).toBeTruthy();
        const seen = new Set<string>();
        for (const a of u.sheet.abilities) {
          if (seen.has(a.name) || a.group === ENHANCEMENTS || a.group === DETACHMENT_RULE) continue;
          if (describesWeaponKeyword(fortyK, { sheet: u.sheet } as Unit, a)) continue;
          seen.add(a.name);
          total++;
          if (isAutomated(fortyK, a)) auto++;
          else if (recognize(a, fortyK)) read++;
        }
      }
      const army = r.army;
      const enh = r.units.flatMap((u) => u.sheet.abilities.filter((a) => a.group === ENHANCEMENTS));
      const items = [
        ...(army?.rules ?? [])
          .filter((a) => !isWeaponRule(fortyK, a))
          .map((a) => !!recognizeArmyRule(a, fortyK)),
        ...enh.map((a) => !!recognizeArmyRule(a, fortyK)),
        ...(army?.stratagems ?? []).map(
          (s) => !!(s.targetsUnit && recognizeStratagem(s.effect ?? s.text, fortyK)),
        ),
      ];
      console.log(
        `${f}: ${r.units.length} units, ${r.points ?? "?"} pts; abilities ${auto} run + ${read} readable of ${total}; ` +
          `detachment ${army?.detachment ?? "none"} (${army?.faction ?? "?"}): ${items.filter(Boolean).length} of ${items.length} readable ` +
          `[rules: ${(army?.rules ?? []).map((a) => a.name).join(", ")}; enhancements: ${enh.map((a) => a.name).join(", ")}; stratagems: ${army?.stratagems.length ?? 0}]` +
          (r.warnings.length ? `; warnings: ${r.warnings.join(" | ")}` : ""),
      );
      expect(army?.detachment).toBeTruthy();
    });
});
