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
/** Terror causes Fear as well. */
export const causesFear = (u: Unit) => causesTerror(u) || hasRule(u, /\bfear\b/i);
/** Frenzy, until the unit loses a combat. */
export const frenzied = (u: Unit) => hasRule(u, /\bfrenzy\b/i) && !u.status?.frenzyLost;
export const hates = (u: Unit) => hasRule(u, /\bhatred\b/i);
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
