import type { ImportedModel, ImportedUnit } from "../systems/wh40k/roster";
import { missingChars, ysParts, type YsProfile, type YsUnit } from "../systems/wh40k/yellowscribe";
import { cleanName, descriptionLines } from "./describe";
import { luaTable } from "./lua";

/**
 * A unit's datasheet from the data Yellowscribe (and BS2TTS) put in its TTS
 * models' scripts (#75): the leader model's LuaScript starts with
 * `local unitData = { unitName, keywords, abilities, models = { profiles },
 * weapons, woundTrack, … }`. That is the list itself, exact where the
 * description is formatted text, so it is read first. Which weapons each
 * model carries is only in its description ("2x Bolt rifle"), so those
 * lines pick from the unit's weapons.
 */

const split = (s: unknown) =>
  typeof s === "string"
    ? s
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];
const list = <T>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? (Object.values(v) as T[]) : [];

/** The unit data in a model's script, in Yellowscribe's JSON shape; null when there is none. */
export function scriptUnit(script: string): YsUnit | null {
  if (!/\bunitData\s*=/.test(script)) return null;
  const t = luaTable(script, "unitData");
  if (!t || typeof t.unitName !== "string") return null;
  const profiles = list<YsProfile>(t.models).filter((p) => p && typeof p.name === "string");
  const track =
    t.woundTrack && typeof t.woundTrack === "object" ? (t.woundTrack as YsUnit["woundTrack"]) : undefined;
  // A tracked profile comes once per bracket ("Name (7+)"): keep the profile once, under its own name.
  const own = profiles.flatMap((p) => {
    for (const name of Object.keys(track ?? {})) {
      if (!p.name.startsWith(`${name} (`)) continue;
      const first = profiles.find((q) => q.name.startsWith(`${name} (`));
      return first === p ? [{ ...p, name }] : [];
    }
    return [p];
  });
  return {
    name: t.unitName,
    factionKeywords: split(t.factionKeywords),
    keywords: split(t.keywords),
    abilities: list(t.abilities),
    modelProfiles: own,
    weapons: list(t.weapons),
    ...(track ? { woundTrack: track } : {}),
    ...(t.isSingleModel === true ? { isSingleModel: true } : {}),
    ...(typeof t.uuid === "string" ? { uuid: t.uuid } : {}),
  };
}

/** The weapons a model's description lists, by name: "Bolt rifle", "2x Bolt rifle". */
function carried(description: string, weapon: (name: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const line of descriptionLines(description)) {
    const m = /^(?:(\d+)\s*x\s+)?(.+)$/i.exec(line);
    const id = m && weapon(m[2]!);
    if (id) for (let i = 0; i < Number(m[1] ?? 1); i++) out.push(id);
  }
  return out;
}

/** A unit from its models' scripts and descriptions; null when no model carries Yellowscribe data. */
export function readScriptedUnit(
  models: { nickname: string; description: string; script?: string }[],
): Pick<ImportedUnit, "name" | "sheet" | "models" | "missing"> | null {
  let data: YsUnit | null = null;
  for (const m of models) if (m.script && (data = scriptUnit(m.script))) break;
  if (!data) return null;
  const parts = ysParts(data);
  const reads = models.map((m) => ({
    nick: cleanName(m.nickname),
    weapons: carried(m.description ?? "", parts.weapon),
  }));
  const all = Object.keys(parts.sheet.weapons);
  // A model whose description names no weapon carries a like model's, else (alone) every one.
  const donor = (nick: string) =>
    reads.find((r) => r.nick === nick && r.weapons.length) ?? reads.find((r) => r.weapons.length);
  const out: ImportedModel[] = reads.map((r) => ({
    profile: parts.profile(r.nick) ?? { name: r.nick || parts.name, chars: {} },
    weapons: r.weapons.length ? r.weapons : [...(donor(r.nick)?.weapons ?? all)],
  }));
  const missing = missingChars(out);
  return { name: parts.name, sheet: parts.sheet, models: out, ...(missing.length ? { missing } : {}) };
}
