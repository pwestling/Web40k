import type { GameState, Unit } from "../../core/types";
import { parseDice, type DiceExpr } from "../../core/dice";

/**
 * Special rules a regiment has, by name only: the roster's special rules and
 * keywords (the player's own data, never rules text). Psychology and magic
 * read them here. Names match loosely ("Causes Fear", "Fear", "Hatred (all
 * enemies)"), so lists written either way work.
 */

const names = (u: Unit) => [...(u.sheet?.abilities ?? []).map((a) => a.name), ...(u.sheet?.keywords ?? [])];

export const hasRule = (u: Unit, re: RegExp) => names(u).some((n) => re.test(n));

export const causesTerror = (u: Unit) => hasRule(u, /\bterror\b/i);
/** Terror causes Fear as well. ("Fear of Elves" is a fear the unit has, not one it causes.) */
export const causesFear = (u: Unit) => causesTerror(u) || hasRule(u, /\bfear\b(?!\s+of\b)/i);
/** Frenzy, until the unit loses a combat. */
export const frenzied = (u: Unit) => hasRule(u, /\bfrenzy\b/i) && !u.status?.frenzyLost;

/** A word as foes are named: lower case, singular ("Elves" and "Elf" match). */
const stemWord = (w: string) =>
  w
    .toLowerCase()
    .replace(/ves$/, "f")
    .replace(/(?<=[^s])s$/, "");

/**
 * The races a rule naming its foes ("Hatred (Dwarfs)") calls each army by,
 * from the army's faction keyword as the list builder writes it ("Faction:
 * Dwarfen Mountain Holds", or a variant list "Faction: Warriors of Chaos -
 * Wolves of the Sea"). Army names only: the 17 armies of the game.
 */
const FACTION_RACES: [RegExp, string][] = [
  [/^beastmen br[ae]yherds/i, "Beastmen Beastman Brayherds Breyherds"],
  [/^chaos dwarfs/i, "Chaos Dwarfs"],
  [/^daemons of chaos/i, "Daemons Daemonic models"],
  [/^dark elves/i, "Dark Elves"],
  [/^dwarfen mountain holds/i, "Dwarfs"],
  [/^grand cathay/i, "Cathay Cathayans"],
  [/^high elf realms/i, "High Elves"],
  [/^(kingdom of )?bretonnia/i, "Bretonnians"],
  [/^lizardmen/i, "Lizardmen"],
  [/^ogre kingdoms/i, "Ogres"],
  [/^orc (and|&) goblin tribes/i, "Orcs Goblins"],
  [/^skaven/i, "Skaven"],
  [/^(the )?empire of man/i, "Empire"],
  [/^tomb kings/i, "Tomb Kings"],
  [/^vampire counts/i, "Vampire Counts"],
  [/^warriors of chaos/i, "Warriors of Chaos"],
  [/^wood elf realms/i, "Wood Elves"],
];

/** The races a unit's faction keyword names it by, for rules that name their foes. */
export function racesOf(u: Unit): string[] {
  return (u.sheet?.keywords ?? []).flatMap((k) => {
    const army = /^faction:\s*(.+)$/i.exec(k.trim())?.[1] ?? k.trim();
    return FACTION_RACES.filter(([re]) => re.test(army)).map(([, races]) => races);
  });
}

/**
 * Whether `u` hates `foe`: "Hatred" or "Hatred (all enemies)" hates everyone;
 * "Hatred (High Elves)" or "Hatred (Orcs & Goblins)" only a foe whose name,
 * keywords or army (its faction keyword, as `racesOf` names its race) carry
 * those words. "Daemonic models" are a daemon army's, or any with a Daemonic
 * rule; "Daemons of Khorne" a model with the rule "Daemon of Khorne".
 */
export function hatesFoe(u: Unit, foe: Unit): boolean {
  const all = names(u).filter((n) => /\bhatred\b/i.test(n));
  if (!all.length) return false;
  const daemonic = (foe.sheet?.abilities ?? []).map((a) => a.name).filter((n) => /^daemon(ic)?\b/i.test(n));
  const theirs = new Set(
    [
      foe.name,
      ...(foe.sheet?.keywords ?? []),
      ...racesOf(foe),
      ...daemonic,
      ...(daemonic.length ? ["Daemonic models"] : []),
    ]
      .flatMap((t) => t.split(/[^\p{L}]+/u))
      .map(stemWord),
  );
  return all.some((n) => {
    const who = /\(([^)]*)\)/.exec(n)?.[1]?.trim();
    if (!who || /\ball\b/i.test(who)) return true;
    // "Orcs & Goblins": either; "High Elves": both words.
    return who.split(/\s*(?:&|,|\band\b|\bor\b)\s*/i).some((part) => {
      const words = part.split(/\s+/).filter((w) => w.length > 1);
      return words.length > 0 && words.every((w) => theirs.has(stemWord(w)));
    });
  });
}

/**
 * The number in a rule's name ("Regeneration (5+)" 5, "Armour Bane (2)" 2,
 * "Magic Resistance (-1)" 1), or 0 when the unit hasn't the rule.
 */
export function ruleNumber(u: Unit, re: RegExp): number {
  let best = 0;
  for (const n of names(u)) {
    if (!re.test(n)) continue;
    const m = /\(\s*[-+]?(\d+)/.exec(n);
    best = Math.max(best, m ? Number(m[1]) : 1);
  }
  return best;
}

/**
 * Random Movement: a Movement written as dice ("2D6+1", "3D6") is rolled each
 * time the unit moves or charges, and is never a fixed number of inches.
 * The dice, from its first model standing, or null for a plain Movement.
 */
export function randomMovement(state: GameState, u: Unit): (DiceExpr & { text: string }) | null {
  const m = (u.modelIds.map((id) => state.models[id]).find((x) => x && !x.destroyed)?.profile?.chars.M ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!/^\d*D\d/.test(m)) return null;
  try {
    const d = parseDice(m);
    return d.sides ? { ...d, text: m } : null;
  } catch {
    return null;
  }
}

/** A unit's troop type, from its first model standing ("Heavy Infantry"), or "". */
export const troopOf = (state: GameState, u: Unit) =>
  u.modelIds.map((id) => state.models[id]).find((m) => m && !m.destroyed)?.profile?.chars.Troop ?? "";
export const stupid = (u: Unit) => hasRule(u, /\bstupidity\b/i);
export const stubborn = (u: Unit) => hasRule(u, /\bstubborn\b/i);
export const unbreakable = (u: Unit) => hasRule(u, /\bunbreakable\b/i);
/** Immune to Psychology; frenzied units are too while their frenzy lasts. */
export const immune = (u: Unit) => hasRule(u, /immune to psychology/i) || frenzied(u);

/** The army's General: named so, or with a General keyword or status (missions use the same test). */
export const isGeneral = (u: Unit) =>
  /\bgeneral\b/i.test(u.name) ||
  (u.sheet?.keywords ?? []).some((k) => /general/i.test(k)) ||
  !!u.status?.general;

/** Carries the army's Battle Standard: a model or a rule of that name. */
export const hasBattleStandard = (state: GameState, u: Unit) =>
  hasRule(u, /battle standard/i) ||
  u.modelIds.some((id) => {
    const m = state.models[id];
    return m && !m.destroyed && /battle standard/i.test(m.profile?.name ?? "");
  });

/** A wizard's level: from the sheet, else a "Level 2 Wizard" rule; 0 for none. */
export function wizardLevel(u: Unit): number {
  if (u.sheet?.wizard) return u.sheet.wizard;
  for (const n of names(u)) {
    const m = /level\s*(\d)\s*wizard|wizard\s*(?:\(?\s*level\s*)?(\d)/i.exec(n);
    if (m) return Number(m[1] ?? m[2]);
  }
  return u.sheet?.spells?.length ? 1 : 0;
}
