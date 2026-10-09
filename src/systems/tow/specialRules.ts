import type { GameState, Unit } from "../../core/types";

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
 * Whether `u` hates `foe`: "Hatred" or "Hatred (all enemies)" hates everyone;
 * "Hatred (High Elves)" or "Hatred (Orcs & Goblins)" only a foe whose name or
 * keywords (its faction) carry those words.
 */
export function hatesFoe(u: Unit, foe: Unit): boolean {
  const all = names(u).filter((n) => /\bhatred\b/i.test(n));
  if (!all.length) return false;
  const theirs = new Set(
    [foe.name, ...(foe.sheet?.keywords ?? [])].flatMap((t) => t.split(/[^\p{L}]+/u)).map(stemWord),
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
