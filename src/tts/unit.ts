import type { Ability, Characteristics, WeaponProfile } from "../core";
import type { ImportedModel, ImportedUnit } from "../systems/wh40k/roster";
import { cleanName, readDescription, type TtsProfile } from "./describe";

/**
 * One unit from its TTS models (#74): each model's description read with
 * describe.ts, then put together the way a roster import would have it, so
 * the army plays like any other. Models keep their order (the table import
 * lays them over their TTS positions one to one).
 */

/** The unit's characteristics a card needs; the ones none of its descriptions gave are `missing`. */
const CORE = ["M", "T", "SV", "W", "LD", "OC"];

interface TtsUnitRead {
  unit: Pick<ImportedUnit, "name" | "sheet" | "models"> & { missing?: string[] };
  /** Description lines no part of the reader could place. */
  unparsed: string[];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "weapon"
  );
}

/** Read a unit from its models' nicknames and raw descriptions; null when none says anything of a profile. */
export function readTtsUnit(
  name: string,
  models: { nickname: string; description: string }[],
): TtsUnitRead | null {
  const unitName = cleanName(name) || name.trim();
  const reads = models.map((m) => {
    const nick = cleanName(m.nickname);
    return { nick, profile: readDescription(m.description ?? "", [nick, unitName]) };
  });
  const said = (p: TtsProfile) => Object.keys(p.chars).length > 0 || p.weapons.length > 0;
  if (!reads.some((r) => said(r.profile))) return null;

  // Weapons table shared by the unit, one key per distinct profile.
  const weapons: Record<string, WeaponProfile> = {};
  const bySig = new Map<string, string>();
  const keyOf = (w: Omit<WeaponProfile, "id">) => {
    const sig = JSON.stringify([w.name.toLowerCase(), w.kind, w.chars, w.keywords]);
    const hit = bySig.get(sig);
    if (hit) return hit;
    const base = `${slug(w.name)}-${w.kind}`;
    let id = base;
    for (let i = 2; id in weapons; i++) id = `${base}-${i}`;
    weapons[id] = { id, ...w };
    bySig.set(sig, id);
    return id;
  };

  const abilities: Ability[] = [];
  const keywords: string[] = [];
  const unparsed: string[] = [];
  let points: number | undefined;
  for (const { profile } of reads) {
    for (const a of profile.abilities) {
      const same = abilities.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      if (!same) abilities.push({ ...a });
      else if (!same.text && a.text) same.text = a.text;
    }
    for (const k of profile.keywords) if (!keywords.includes(k)) keywords.push(k);
    for (const l of profile.unparsed) if (!unparsed.includes(l)) unparsed.push(l);
    points ??= profile.points;
  }

  // A model whose description is blank wears the profile of one like it: same nickname, else the first that has one.
  const donor = (nick: string) =>
    reads.find((r) => r.nick === nick && said(r.profile)) ?? reads.find((r) => said(r.profile))!;
  const out: ImportedModel[] = reads.map((r) => {
    const from = said(r.profile) ? r : donor(r.nick);
    const chars: Characteristics = {
      ...(Object.keys(from.profile.chars).length ? from.profile.chars : donor(r.nick).profile.chars),
    };
    const own = from.profile.weapons.length ? from.profile.weapons : donor(r.nick).profile.weapons;
    return { profile: { name: r.nick || unitName, chars }, weapons: own.map(keyOf) };
  });

  const first = out[0]?.profile.chars ?? {};
  const missing = CORE.filter((k) => !first[k]);
  return {
    unit: {
      name: unitName,
      sheet: { weapons, abilities, keywords, ...(points ? { points } : {}) },
      models: out,
      ...(missing.length ? { missing } : {}),
    },
    unparsed,
  };
}
