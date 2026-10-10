import type { Ability, AbilityAuto, Army, ArmyPack, ArmyStratagem, PlayerId } from "../core/types";
import type { GameSystem } from "../core/content/schema";
import { compile } from "../systems/wh40k/recognize";
import { teach } from "../systems/wh40k/teach";
import {
  ARMY_RULE,
  DETACHMENT_RULE,
  ENHANCEMENTS,
  stratagemId,
  type ImportedRoster,
} from "../systems/wh40k/roster";
import { readLiteral, readManifest, type Manifest } from "./manifest";
import type { FactionPack, PackRule, PackStratagem } from "./factionFormat";

/**
 * Faction packs (#76): reading one as data, and applying it to an army by
 * name. Loading, consent and pinning are in packPins.ts; the format is in
 * factionFormat.ts and docs/faction-packs.md.
 */

export interface ReadPack {
  manifest: Manifest;
  pack: FactionPack;
  /** It has code (an `export default`), which runs in the game's sandbox. */
  code: boolean;
}

/** A faction pack's manifest and data, read without running it. */
export function readFactionPack(source: string): ReadPack | { error: string } {
  const read = readManifest(source);
  if ("error" in read) return read;
  if (read.manifest.kind !== "faction")
    return { error: "That isn't a faction pack (its manifest kind isn't \"faction\")." };
  const data = readLiteral(source, "faction");
  if (!data) return { error: "This pack has no `export const faction = { ... }`." };
  if ("error" in data) return data;
  const problem = checkPack(data.value);
  if (problem) return { error: problem };
  return {
    manifest: read.manifest,
    pack: data.value as FactionPack,
    code: /\bexport\s+default\b/.test(source),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SIDES = ["active", "inactive", "either"];

/** The first thing wrong with a pack's data, or null. */
function checkPack(v: unknown): string | null {
  if (!isObj(v)) return "`faction` must be an object.";
  const list = (x: unknown, where: string, each: (r: unknown, at: string) => string | null) => {
    if (x === undefined) return null;
    if (!Array.isArray(x)) return `${where} must be a list.`;
    for (const [i, r] of x.entries()) {
      const p = each(r, `${where}[${i}]`);
      if (p) return p;
    }
    return null;
  };
  const rule = (r: unknown, at: string) =>
    !isObj(r) || typeof r.name !== "string" || !r.name.trim()
      ? `${at} needs a name.`
      : r.auto !== undefined && !(isObj(r.auto) && Array.isArray(r.auto.parts))
        ? `${at}.auto needs parts.`
        : r.effects !== undefined && !Array.isArray(r.effects)
          ? `${at}.effects must be a list.`
          : null;
  const strat = (r: unknown, at: string) =>
    rule(r, at) ??
    (typeof (r as PackStratagem).cp !== "number"
      ? `${at} needs a cp number.`
      : !SIDES.includes((r as PackStratagem).side)
        ? `${at}.side must be "active", "inactive" or "either".`
        : null);
  return (
    list(v.rules, "rules", rule) ??
    list(v.abilities, "abilities", rule) ??
    list(v.stratagems, "stratagems", strat) ??
    list(v.detachments, "detachments", (d, at) => {
      if (!isObj(d) || typeof d.name !== "string") return `${at} needs a name.`;
      return (
        list(d.rules, `${at}.rules`, rule) ??
        list(d.enhancements, `${at}.enhancements`, rule) ??
        list(d.stratagems, `${at}.stratagems`, strat)
      );
    })
  );
}

/**
 * A name as packs match it: case, accents, punctuation, spacing and a cost
 * in the name ("(1CP)") don't count; "Smoke-Veil", "smoke veil" and
 * "SMOKE VEIL (1 CP)" are one name.
 */
export function packName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(\s*\d+\s*cp\s*\)/g, " ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** What a pack rule does, as the automated-ability data units and stratagems carry (#38). */
function autoOf(rule: PackRule, system: GameSystem, pack: string): AbilityAuto | null {
  if (rule.auto) {
    const effects = rule.auto.effects ?? compile(rule.auto.parts, system);
    return effects ? { ...rule.auto, effects, pack } : null;
  }
  if (rule.teach) {
    const taught = teach(rule.teach, system);
    if (!taught) return null;
    const { taught: _, ...auto } = taught;
    return { ...auto, pack };
  }
  if (rule.effects) return { parts: [], effects: rule.effects, pack };
  if (rule.code) return { parts: [], effects: [], pack };
  return null;
}

/** The player's own taught rule stays; anything else a pack may set. */
const mayReplace = (auto: AbilityAuto | undefined) => !auto?.taught;

const withAuto = <A extends { auto?: AbilityAuto }>(a: A, auto: AbilityAuto | null): A => {
  const { auto: _, ...rest } = a;
  return (auto ? { ...rest, auto } : rest) as A;
};

/** A pack's rules taken off an army (before a new version goes on): its rules and the stratagems it added. */
function removePack(roster: ImportedRoster, pack: string): ImportedRoster {
  const strip = <A extends { auto?: AbilityAuto }>(a: A): A =>
    a.auto?.pack === pack ? withAuto(a, null) : a;
  const units = roster.units.map((u) => ({
    ...u,
    sheet: { ...u.sheet, abilities: u.sheet.abilities.map(strip) },
  }));
  if (!roster.army) return { ...roster, units };
  const army: Army = {
    ...roster.army,
    rules: roster.army.rules.map(strip),
    stratagems: roster.army.stratagems.filter((s) => s.pack !== pack).map(strip),
  };
  return { ...roster, units, army };
}

interface Applied {
  roster: ImportedRoster;
  /** Rules, abilities and stratagems the pack automated or added (an ability counted once per unit). */
  count: number;
}

/**
 * Put a faction pack's rules on an army: every ability, detachment rule,
 * enhancement and stratagem whose name matches gets the pack's rule (a
 * player's own taught rule stays), and the detachment's stratagems the list
 * didn't carry are added. The army keeps the pack's ref, so the table can
 * see which bytes made its rules. An army it doesn't touch comes back as it was.
 */
export function applyPack(
  roster: ImportedRoster,
  pack: FactionPack,
  ref: ArmyPack,
  system: GameSystem,
): Applied {
  const name = ref.name;
  const base = removePack(roster, name);
  const detachment = base.army?.detachment
    ? pack.detachments?.find((d) => packName(d.name) === packName(base.army!.detachment!))
    : undefined;
  const byName = new Map<string, PackRule>();
  for (const r of [...(pack.rules ?? []), ...(pack.abilities ?? []), ...(detachment?.enhancements ?? [])])
    byName.set(packName(r.name), r);
  let count = 0;

  const units = base.units.map((u) => {
    const seen = new Set<string>();
    const abilities = u.sheet.abilities.map((a) => {
      const rule = byName.get(packName(a.name));
      if (!rule || !mayReplace(a.auto)) return a;
      const auto = autoOf(rule, system, name);
      if (!auto) return a;
      if (!seen.has(packName(a.name))) count++;
      seen.add(packName(a.name));
      return withAuto(a, auto);
    });
    return { ...u, sheet: { ...u.sheet, abilities } };
  });

  const armyRules = [...(pack.rules ?? []), ...(detachment?.rules ?? [])];
  const strats = [...(detachment?.stratagems ?? []), ...(pack.stratagems ?? [])];
  let army = base.army;
  if (!army && count) army = { rules: [], stratagems: [] };
  if (army) {
    const rules: Ability[] = army.rules.map((r) => {
      const rule = armyRules.find((p) => packName(p.name) === packName(r.name));
      const auto = rule && mayReplace(r.auto) ? autoOf(rule, system, name) : null;
      if (!auto) return r;
      count++;
      return withAuto(r, auto);
    });
    // The detachment's rules the list didn't carry: the army gets them, in the author's words.
    const onUnits = new Set(units.flatMap((u) => u.sheet.abilities.map((a) => packName(a.name))));
    // So do the faction's rules, when the army is that faction.
    const faction = !!pack.faction && !!army.faction && packName(pack.faction) === packName(army.faction);
    const missing = [
      ...(detachment?.rules ?? []).map((rule) => ({ rule, group: DETACHMENT_RULE })),
      ...(faction ? (pack.rules ?? []) : []).map((rule) => ({ rule, group: ARMY_RULE })),
    ];
    for (const { rule, group } of missing) {
      const key = packName(rule.name);
      if (rules.some((r) => packName(r.name) === key) || onUnits.has(key)) continue;
      const auto = autoOf(rule, system, name);
      rules.push({ name: rule.name, text: rule.summary ?? "", group, ...(auto ? { auto } : {}) });
      count++;
    }
    const taken = new Set(army.stratagems.map((s) => s.id));
    const stratagems: ArmyStratagem[] = army.stratagems.map((s) => {
      const p = strats.find((x) => packName(x.name) === packName(s.name));
      if (!p) return s;
      count++;
      return stratagemFrom(p, s, system, name);
    });
    for (const p of strats) {
      if (stratagems.some((s) => packName(s.name) === packName(p.name))) continue;
      const added = {
        id: stratagemId(p.name, taken),
        name: p.name,
        cp: p.cp,
        side: p.side,
        text: p.summary ?? "",
      };
      stratagems.push({ ...stratagemFrom(p, added, system, name), pack: name });
      count++;
    }
    army = { ...army, rules, stratagems };
  }
  if (!count) return { roster, count: 0 };
  const packs = [...(army?.packs ?? []).filter((p) => p.id !== ref.id), ref];
  return { roster: { ...base, units, ...(army ? { army: { ...army, packs } } : {}) }, count };
}

/** A stratagem as the pack has it: its cost, timing and target, over what the list said. */
function stratagemFrom(p: PackStratagem, s: ArmyStratagem, system: GameSystem, pack: string): ArmyStratagem {
  const { phases: _p, once: _o, targetKeywords: _k, notYet: _n, targetsUnit: _t, ...rest } = s;
  const target = p.target === false ? null : (p.target ?? {});
  const out: ArmyStratagem = {
    ...rest,
    cp: p.cp,
    side: p.side,
    ...(p.phases?.length ? { phases: p.phases } : {}),
    ...(p.once && p.once !== "phase" ? { once: p.once } : {}),
    ...(target ? { targetsUnit: true } : {}),
    ...(target?.keywords ? { targetKeywords: target.keywords } : {}),
    ...(target?.notYet ? { notYet: target.notYet } : {}),
    ...(!s.effect && p.summary ? { effect: p.summary } : {}),
  };
  if (!mayReplace(s.auto)) return { ...out, auto: s.auto! };
  const auto = autoOf(p, system, pack);
  return withAuto(out, auto);
}

/**
 * How many of an army's rules a faction pack plays, for the import's coverage
 * lines: unit abilities, and the detachment's (its rules, enhancements and
 * stratagems), counted as those lines count them.
 */
export function packAutomated(roster: ImportedRoster): { units: number; army: number } {
  const army = new Set([ENHANCEMENTS, DETACHMENT_RULE, ARMY_RULE]);
  let units = 0;
  let enhancements = 0;
  for (const u of roster.units) {
    const played = u.sheet.abilities.filter((a) => a.auto?.pack);
    units += new Set(played.filter((a) => !army.has(a.group ?? "")).map((a) => a.name)).size;
    enhancements += played.filter((a) => a.group === ENHANCEMENTS).length;
  }
  return {
    units,
    army:
      enhancements +
      (roster.army?.rules.filter((r) => r.auto?.pack).length ?? 0) +
      (roster.army?.stratagems.filter((s) => s.auto?.pack).length ?? 0),
  };
}

/**
 * Where the table's faction packs disagree (#76): a player's army made with
 * other bytes of a pack than another army, or than this device pinned. Like a
 * rules package's mismatch, the players should compare before they play.
 */
export function packMismatches(
  armies: Record<PlayerId, Army | undefined>,
  mine: { id: string; hash: string }[],
): { player: PlayerId; pack: ArmyPack; other: string }[] {
  const out: { player: PlayerId; pack: ArmyPack; other: string }[] = [];
  const seen = new Map<string, string>(mine.map((m) => [m.id, m.hash]));
  for (const [player, army] of Object.entries(armies))
    for (const pack of army?.packs ?? []) {
      const other = seen.get(pack.id);
      if (other && other !== pack.hash) out.push({ player, pack, other });
      else if (!other) seen.set(pack.id, pack.hash);
    }
  return out;
}
