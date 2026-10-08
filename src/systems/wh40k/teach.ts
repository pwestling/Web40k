import type { AbilityAuto, AutoPart } from "../../core";
import type { GameSystem } from "../../core/content/schema";
import { compile } from "./recognize";

/**
 * "Teach it this rule" (#53): a rule the player builds by picking when, who
 * and what, for an ability the app only reminds them of. It compiles to the
 * same automated-ability data the recognizer proposes (#38), so it runs, shows
 * and saves the same way.
 */

export type TeachWhen =
  /** Its attacks (or attacks against it), maybe only ranged or melee, after charging or standing still, against a keyword. */
  | {
      kind: "attacks";
      weapon?: "ranged" | "melee";
      when?: "charged" | "stationary";
      against?: string;
    }
  /** At the start or end of one of its owner's phases (or each player's). */
  | { kind: "phase"; phase: string; at: "start" | "end"; anyTurn?: boolean };

export type TeachWho =
  | { kind: "self" }
  /** The unit this model leads, while it leads it. */
  | { kind: "leading" }
  | { kind: "aura"; side: "friendly" | "enemy"; range: number; keyword?: string };

export type TeachWhat =
  | { kind: "reroll"; roll: "hit" | "wound" | "damage"; which: "ones" | "failed" }
  /** Its own hit or wound rolls. */
  | { kind: "modify"; roll: "hit" | "wound"; by: number }
  /** Attacks against it: harder (−1) or easier (+1) to hit or wound. */
  | { kind: "against"; roll: "hit" | "wound"; by: number }
  /** Its saving throws against attacks. */
  | { kind: "save"; by: number }
  | { kind: "invuln"; x: number }
  | { kind: "fnp"; x: number }
  /** Its weapons' Attacks, Strength or Damage up by `by`; AP improved by `by`. */
  | { kind: "stat"; stat: "A" | "S" | "AP" | "D"; by: number }
  | { kind: "gain"; amount: number }
  | { kind: "heal"; amount: string };

export interface Teaching {
  when: TeachWhen;
  who: TeachWho;
  what: TeachWhat[];
  /** Used once per battle from the unit card, then runs until the end of that phase. */
  oncePerBattle?: boolean;
}

/** Effects that only make sense at a phase's start or end. */
const AT_PHASE = new Set<TeachWhat["kind"]>(["gain", "heal"]);

function partOf(w: TeachWhat, when: Extract<TeachWhen, { kind: "attacks" }>): AutoPart | null {
  const filters = {
    ...(when.weapon ? { weapon: when.weapon } : {}),
    ...(when.against?.trim() ? { against: [when.against.trim().toLowerCase()] } : {}),
  };
  const mine = {
    kind: "attack" as const,
    side: "making" as const,
    ...filters,
    ...(when.when ? { when: when.when } : {}),
  };
  // Attacks against it: "after charging" is the attacker's, so it doesn't apply here.
  const theirs = { kind: "attack" as const, side: "targeted" as const, ...filters };
  switch (w.kind) {
    case "reroll":
      return { ...mine, roll: w.roll, reroll: w.which };
    case "modify":
      return w.by ? { ...mine, roll: w.roll, by: w.by } : null;
    case "against":
      return w.by ? { ...theirs, roll: w.roll, by: w.by } : null;
    case "save":
      return w.by ? { ...theirs, roll: "save", by: w.by } : null;
    case "stat":
      if (!w.by) return null;
      if (w.stat === "D") return { ...mine, roll: "damage", by: w.by };
      // AP improves downwards: "AP improved by 1" is −1.
      return { ...mine, stat: w.stat, by: w.stat === "AP" ? -Math.abs(w.by) : w.by };
    case "invuln":
      return w.x >= 2 && w.x <= 6 ? { kind: "invuln", x: w.x } : null;
    case "fnp":
      return w.x >= 2 && w.x <= 6 ? { kind: "fnp", x: w.x } : null;
    default:
      return null;
  }
}

/** The automated rule a teaching compiles to; null when its pieces don't fit together. */
export function teach(teaching: Teaching, system: GameSystem): AbilityAuto | null {
  const { when, who, what } = teaching;
  if (!what.length) return null;
  const parts: AutoPart[] = [];
  let trigger: AbilityAuto["trigger"];
  if (when.kind === "phase") {
    // At a phase's start or end: CP or wounds back, nothing that waits for an attack.
    if (what.some((w) => !AT_PHASE.has(w.kind)) || teaching.oncePerBattle || who.kind === "aura") return null;
    trigger = { phase: when.phase, at: when.at, ...(when.anyTurn ? { anyTurn: true } : {}) };
    for (const w of what) {
      if (w.kind === "gain" && w.amount > 0) {
        parts.push({ kind: "gain", resource: "CP", amount: w.amount });
        trigger.gain = { resource: "CP", amount: w.amount };
      } else if (w.kind === "heal" && /^(d3|d6|\d+)$/i.test(w.amount)) {
        parts.push({ kind: "heal", amount: w.amount.toUpperCase() });
        trigger.heal = w.amount.toUpperCase();
      } else return null;
    }
  } else {
    for (const w of what) {
      if (AT_PHASE.has(w.kind)) return null;
      const p = partOf(w, when);
      if (!p) return null;
      parts.push(p);
    }
  }
  const effects = compile(parts, system);
  if (!effects) return null;
  const auto: AbilityAuto = { parts, effects, taught: true };
  if (trigger) auto.trigger = trigger;
  if (teaching.oncePerBattle) auto.oncePerBattle = true;
  if (who.kind === "leading") auto.whileLeading = true;
  if (who.kind === "aura") {
    if (!(who.range > 0)) return null;
    auto.aura = {
      range: who.range,
      side: who.side,
      ...(who.keyword?.trim() ? { keyword: who.keyword.trim().toLowerCase() } : {}),
    };
  }
  return auto;
}

/** A taught (or recognized) rule read back into the builder's terms, to change it. */
export function teachingOf(auto: AbilityAuto): Teaching {
  const who: TeachWho = auto.aura
    ? { kind: "aura", ...auto.aura }
    : auto.whileLeading
      ? { kind: "leading" }
      : { kind: "self" };
  if (auto.trigger)
    return {
      when: {
        kind: "phase",
        phase: auto.trigger.phase,
        at: auto.trigger.at,
        ...(auto.trigger.anyTurn ? { anyTurn: true } : {}),
      },
      who,
      what: auto.parts.flatMap((p): TeachWhat[] =>
        p.kind === "gain"
          ? [{ kind: "gain", amount: p.amount }]
          : p.kind === "heal"
            ? [{ kind: "heal", amount: p.amount }]
            : [],
      ),
    };
  const first = auto.parts.find((p) => p.kind === "attack");
  const when: TeachWhen = {
    kind: "attacks",
    ...(first?.weapon ? { weapon: first.weapon } : {}),
    ...(first?.side === "making" && first.when ? { when: first.when } : {}),
    ...(first?.against?.[0] ? { against: first.against[0] } : {}),
  };
  const what = auto.parts.flatMap((p): TeachWhat[] => {
    if (p.kind === "fnp") return [{ kind: "fnp", x: p.x }];
    if (p.kind === "invuln") return [{ kind: "invuln", x: p.x }];
    if (p.kind !== "attack") return [];
    if (p.reroll && p.roll && p.roll !== "save") return [{ kind: "reroll", roll: p.roll, which: p.reroll }];
    if (p.stat) return [{ kind: "stat", stat: p.stat, by: Math.abs(p.by ?? 0) }];
    if (p.roll === "damage") return [{ kind: "stat", stat: "D", by: p.by ?? 0 }];
    if (p.roll === "save") return [{ kind: "save", by: p.by ?? 0 }];
    if (p.roll && p.side === "targeted") return [{ kind: "against", roll: p.roll, by: p.by ?? 0 }];
    if (p.roll) return [{ kind: "modify", roll: p.roll, by: p.by ?? 0 }];
    return [];
  });
  return { when, who, what, ...(auto.oncePerBattle ? { oncePerBattle: true } : {}) };
}
