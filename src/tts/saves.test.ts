import { describe, expect, it } from "vitest";
import { isAutomated } from "../core/content/player";
import { getSystem } from "../core/content/systems";
import { cleanName } from "./describe";
import { unitFromTts } from "./profiles";
import { readTtsUnit } from "./unit";

/**
 * Real input (#74): Tabletop Simulator saves of 40k armies, never committed.
 * Runs only with TTS_SAVES=<folder of save .json files>, and prints for each
 * save what the description reader makes of it: units read, weapons,
 * abilities the app runs against those left as reminders, and lines it
 * couldn't place. Units are grouped here the simple way (a model's bag, else
 * its name); the table import (#73) does that properly.
 */
const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TTS_SAVES;
interface Fs {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
}
const fs = dir ? ((await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs) : null;
const files = fs ? fs.readdirSync(dir!).filter((f) => f.endsWith(".json")) : [];

interface TtsObject {
  Nickname?: string;
  Description?: string;
  ContainedObjects?: TtsObject[];
  ChildObjects?: TtsObject[];
  States?: Record<string, TtsObject>;
}

function groups(save: { ObjectStates?: TtsObject[] }) {
  const out = new Map<string, { nickname: string; description: string }[]>();
  const visit = (o: TtsObject, bag?: string) => {
    const nick = cleanName(o.Nickname ?? "");
    if (o.Description?.trim()) {
      const key = bag || nick || "?";
      out.set(key, [...(out.get(key) ?? []), { nickname: o.Nickname ?? "", description: o.Description }]);
    }
    for (const c of o.ContainedObjects ?? []) visit(c, nick || bag);
    for (const c of o.ChildObjects ?? []) visit(c, bag);
  };
  for (const o of save.ObjectStates ?? []) visit(o);
  return out;
}

describe.skipIf(!dir)("real Tabletop Simulator saves", () => {
  const system = getSystem("forty-k-11");
  for (const f of files)
    it(f, () => {
      const save = JSON.parse(fs!.readFileSync(`${dir}/${f}`, "utf8")) as { ObjectStates?: TtsObject[] };
      const found = groups(save);
      let units = 0;
      let weapons = 0;
      let automated = 0;
      let reminders = 0;
      const unparsed: string[] = [];
      for (const [name, models] of found) {
        const u = unitFromTts({ system: "forty-k-11", name, models });
        if (!u) continue;
        units++;
        weapons += Object.keys(u.sheet!.weapons).length;
        for (const a of u.sheet!.abilities)
          if (a.auto || isAutomated(system, a)) automated++;
          else reminders++;
        unparsed.push(...(readTtsUnit(name, models)?.unparsed ?? []).map((l) => `${name}: ${l}`));
      }
      console.log(
        `${f}: ${units} of ${found.size} described groups read as units, ${weapons} weapons, ` +
          `${automated} abilities automated, ${reminders} reminders, ${unparsed.length} lines unread` +
          unparsed
            .slice(0, 8)
            .map((l) => `\n  ? ${l.slice(0, 100)}`)
            .join(""),
      );
      expect(found.size === 0 || units > 0).toBe(true);
    });
});
