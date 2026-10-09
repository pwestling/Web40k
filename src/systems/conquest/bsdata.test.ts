import { describe, expect, it } from "vitest";
import { bindRules, lookupRules } from "../../core/content/runtime";
import { isAutomated } from "../../core/content/player";
import type { Ability } from "../../core";
import { importConquestList } from "./roster";
import { conquest } from "./system";

/**
 * Real input (#66): rosters built from the public BSData Conquest catalogue by
 * `node scripts/bsdata-conquest.mjs`, never committed. Runs only with
 * BSDATA_CONQUEST=<folder>, and prints which special rules play themselves.
 */
const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .BSDATA_CONQUEST;
interface Fs {
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
}
const fs = dir ? ((await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs) : null;
const files = fs ? fs.readdirSync(dir!).filter((f) => f.endsWith(".ros")) : [];

/** "automated", "reminder" (named at the right time) or "none" (text only). */
function statusOf(a: Ability): "automated" | "reminder" | "none" {
  if (isAutomated(conquest, a)) return "automated";
  const text = `${a.name} ${a.text}`.trim();
  return lookupRules(conquest, bindRules(conquest.rules, [text], "unit")).length ? "reminder" : "none";
}

describe.skipIf(!dir)("real Conquest rosters from BSData", () => {
  for (const f of files)
    it(f, async () => {
      const r = await importConquestList(f, fs!.readFileSync(`${dir}/${f}`));
      expect(r.units.length).toBeGreaterThan(0);
      const tally = { automated: 0, reminder: 0, none: 0 };
      const byRule = new Map<string, { n: number; status: string }>();
      for (const u of r.units) {
        for (const k of ["M", "C", "D", "R", "W"])
          expect(u.models[0]!.profile.chars[k], `${u.name} ${k}`).toBeTruthy();
        for (const a of u.sheet.abilities) {
          const s = statusOf(a);
          tally[s]++;
          const key = a.name.replace(/\s*\d.*$/, "");
          byRule.set(key, { n: (byRule.get(key)?.n ?? 0) + 1, status: s });
        }
      }
      const total = tally.automated + tally.reminder + tally.none;
      const rows = [...byRule].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} x${v.n} ${v.status}`);
      console.log(
        `${f}: ${r.units.length} units; special rules ${tally.automated} automated + ${tally.reminder} reminders + ${tally.none} text only, of ${total}\n  ${rows.join("; ")}` +
          (r.warnings.length ? `\n  warnings: ${r.warnings.join(" | ")}` : ""),
      );
    });
});
