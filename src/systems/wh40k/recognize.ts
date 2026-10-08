/**
 * Abilities that play themselves (#38). On the player's device, at import,
 * read an ability's text and propose the rule it describes, for the common
 * shapes: re-rolls and ±1 to hit or wound (its own attacks, or attacks
 * against it), Feel No Pain, auras, start and end of phase triggers, once
 * per battle and while leading. The player confirms each one; anything not
 * read in full stays a reminder. Nothing here holds any rules text: these
 * are patterns for the wording, and the text itself stays the player's.
 */
import { bindRules, lookupRules } from "../../core/content/runtime";
import type { Effect, EffectAction, Expr, GameSystem, Value } from "../../core/content/schema";
import { isAutomated } from "../../core/content/player";
import type { Ability, AbilityAuto, AutoPart } from "../../core/types";

type AttackPart = Extract<AutoPart, { kind: "attack" }>;

const NUMBERS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const PHASES = "command|movement|shooting|charge|fight";

/** Lower case, plain quotes and inches, single spaces, no trailing full stop. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”″]|''/g, '"')
    .replace(/(\d+)\s*(?:"|-?inch(?:es)?\b)/g, '$1"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*$/, "")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<!\d)\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const num = (s: string) => NUMBERS[s] ?? Number(s);

/** "re-roll a hit roll of 1", "add 1 to the wound roll", "that attack has the [lethal hits] ability". */
function readEffect(text: string): Partial<AttackPart> | null {
  let m = /^(?:you can )?re-roll (?:a|the) (hit|wound) roll of (?:1|one)$/.exec(text);
  if (m) return { roll: m[1] as "hit" | "wound", reroll: "ones" };
  m = /^(?:you can )?re-roll the (hit|wound) roll$/.exec(text);
  if (m) return { roll: m[1] as "hit" | "wound", reroll: "failed" };
  m = /^add (1|one) to the (hit|wound) roll$/.exec(text);
  if (m) return { roll: m[2] as "hit" | "wound", by: 1 };
  m = /^subtract (1|one) from the (hit|wound) roll$/.exec(text);
  if (m) return { roll: m[2] as "hit" | "wound", by: -1 };
  m = /^(?:you can )?re-roll (?:a|the) damage roll of (?:1|one)$/.exec(text);
  if (m) return { roll: "damage", reroll: "ones" };
  m = /^(?:you can )?re-roll the damage roll$/.exec(text);
  if (m) return { roll: "damage", reroll: "failed" };
  m = /^add (1|one) to the (?:armou?r )?saving throw$/.exec(text);
  if (m) return { roll: "save", by: 1 };
  m = /^subtract (1|one) from the damage characteristic of (?:that|the) attack$/.exec(text);
  if (m) return { roll: "damage", by: -1 };
  m = /^(?:that attack|that weapon|the attack) has the \[?([a-z0-9 +-]+?)\]? ability$/.exec(text);
  if (m) return { grant: m[1]!.trim() };
  return null;
}

/** Effects joined by "and" (or ", and"). */
function readEffects(text: string): Partial<AttackPart>[] | null {
  const bits = text.split(/,? and (?=re-roll|you can|add|subtract|that attack|that weapon)/);
  const out = bits.map((b) => readEffect(b.trim()));
  return out.every(Boolean) ? (out as Partial<AttackPart>[]) : null;
}

function readCondition(text: string): AttackPart["when"] | null {
  if (/^(?:this|that) unit (?:made a charge move|charged) this turn$/.test(text)) return "charged";
  if (/^(?:this|that) unit remained stationary this turn$/.test(text)) return "stationary";
  return null;
}

/** "each time a model in this unit makes a melee attack (that targets a monster unit), (if …,) …". */
function readAttack(text: string): AttackPart[] | null {
  const making =
    /^each time (?:a model in (?:this|that) unit|this model|this unit) makes an? (?:(ranged|melee) )?attack(?: that targets an? ([a-z -]+?) unit)?,? (.+)$/.exec(
      text,
    );
  const targeted =
    /^each time an? (?:(ranged|melee) )?attack targets (?:this|that) (?:unit|model),? (.+)$/.exec(text);
  const m = making ?? targeted;
  if (!m) return null;
  let rest = (making ? m[3] : m[2])!;
  const part: AttackPart = { kind: "attack", side: making ? "making" : "targeted" };
  if (m[1]) part.weapon = m[1] as "ranged" | "melee";
  if (making && m[2]) part.against = m[2].split(/ or /).map((k) => k.trim());
  const cond = /^if (.+?), (.+)$/.exec(rest);
  if (cond) {
    const when = readCondition(cond[1]!);
    if (!when) return null;
    part.when = when;
    rest = cond[2]!;
  }
  const effects = readEffects(rest);
  if (!effects) return null;
  // Defensively: worse hit/wound rolls, a better save, less damage. Re-rolls and grants are for one's own attacks.
  if (
    !making &&
    effects.some((e) => e.reroll || e.grant || (e.roll === "save" ? (e.by ?? 0) < 0 : (e.by ?? 0) > 0))
  )
    return null;
  // Attacking: the save and the damage characteristic only change from the defender's side here.
  if (making && effects.some((e) => (e.roll === "save" || e.roll === "damage") && e.by)) return null;
  return effects.map((e) => ({ ...part, ...e }));
}

/** "weapons equipped by models in this unit have the [lethal hits] ability". */
function readGrant(text: string): AttackPart[] | null {
  const m =
    /^(?:(ranged|melee) )?weapons equipped by (?:models in (?:this|that) unit|this model) have the \[?([a-z0-9 +-]+?)\]? ability$/.exec(
      text,
    );
  if (!m) return null;
  return [
    { kind: "attack", side: "making", ...(m[1] ? { weapon: m[1] as "ranged" | "melee" } : {}), grant: m[2]! },
  ];
}

function readFnp(text: string): AutoPart[] | null {
  const m =
    /^(?:models in (?:this|that) unit|this model|this unit) (?:has|have) (?:the |a )?feel no pain (\d)\+(?: ability)?$/.exec(
      text,
    );
  return m ? [{ kind: "fnp", x: Number(m[1]) }] : null;
}

interface Trigger {
  phase: string;
  at: "start" | "end";
  anyTurn?: boolean;
}

/** "at the start of your command phase, (if this model is on the battlefield,) you gain 1cp". */
function readTrigger(text: string): { trigger: Trigger; parts: AutoPart[] } | null {
  const m = new RegExp(
    `^(at the start of|at the end of|in) (your|each|either player's|each player's) (${PHASES}) phase,? (?:if this (?:model|unit) is on the battlefield,? )?(.+)$`,
  ).exec(text);
  if (!m) return null;
  const trigger: Trigger = { phase: m[3]!, at: m[1] === "at the end of" ? "end" : "start" };
  if (m[2] !== "your") trigger.anyTurn = true;
  const rest = m[4]!;
  const gain = /^you gain (\d+|one|a|an) ?(?:cp|command points?)$/.exec(rest);
  if (gain) return { trigger, parts: [{ kind: "gain", resource: "CP", amount: num(gain[1]!) }] };
  const heal =
    /^(?:one model in this unit|this model|this unit) regains up to (d3|d6|\d+) lost wounds?$/.exec(rest);
  if (heal) return { trigger, parts: [{ kind: "heal", amount: heal[1]!.toUpperCase() }] };
  return null;
}

interface Prefix {
  oncePerBattle?: boolean;
  whileLeading?: boolean;
  aura?: AbilityAuto["aura"];
}

/** Strip the scoping words in front: once per battle, while leading, while within range of this model. */
function readPrefix(text: string): { prefix: Prefix; rest: string } {
  const prefix: Prefix = {};
  let rest = text;
  for (let changed = true; changed;) {
    changed = false;
    let m =
      /^once per battle,? (?:(?:at the start of|in) (?:any|your|the|your opponent's) (?:[a-z]+ )?phase,? )?(?:this (?:unit|model) can use this ability\.? (?:if (?:it|they) does?,?|when (?:it|they) does?,?) )?(?:until the end of the (?:phase|turn),? )?(.+)$/.exec(
        rest,
      );
    if (m && !prefix.oncePerBattle) {
      prefix.oncePerBattle = true;
      rest = m[1]!;
      changed = true;
      continue;
    }
    m = /^while this model is leading a unit,? (.+)$/.exec(rest);
    if (m && !prefix.whileLeading) {
      prefix.whileLeading = true;
      rest = m[1]!;
      changed = true;
      continue;
    }
    m =
      /^while an? (friendly|enemy) ((?:[a-z-]+ )*?)unit is within (\d+)" of this (?:model|unit),? (.+)$/.exec(
        rest,
      );
    if (m && !prefix.aura) {
      prefix.aura = {
        range: Number(m[3]),
        side: m[1] as "friendly" | "enemy",
        ...(m[2]!.trim() ? { keyword: m[2]!.trim() } : {}),
      };
      rest = m[4]!;
      changed = true;
    }
  }
  return { prefix, rest };
}

const step = (s: string): Effect["when"] => ({ event: "step.before", where: { is: "event.step", value: s } });

/** Put a rule's bound parameters into its expressions, so its effects stand alone. */
function inline<T>(value: T, param: Record<string, unknown>): T {
  if (Array.isArray(value)) return value.map((v) => inline(v, param)) as T;
  if (value && typeof value === "object") {
    const r = (value as { ref?: unknown }).ref;
    if (typeof r === "string" && r.startsWith("param.") && Object.keys(value).length === 1)
      return param[r.slice(6)] as T;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v, param)])) as T;
  }
  return value;
}

/** The engine's rule for a weapon ability's name ("lethal hits", "sustained hits d3"), inlined. */
function weaponRule(system: GameSystem, name: string): Effect[] | null {
  const refs = bindRules(system.rules, [name], "weapon");
  const bound = lookupRules(system, refs)[0];
  if (!bound || bound.def.effects.some((e) => e.do.some((a) => a.do === "manual"))) return null;
  return bound.def.effects.map((e) => inline(e, bound.param as Record<string, Value>));
}

function compileAttack(p: AttackPart, system: GameSystem): Effect[] | null {
  const conds: Expr[] = [{ is: "ruleOwner", value: p.side === "making" ? "attacker" : "target" }];
  if (p.weapon) conds.push({ is: "weapon.weaponKind", value: p.weapon });
  if (p.against) conds.push({ any: p.against.map((k) => ({ hasKeyword: "target", keyword: k })) });
  if (p.when === "charged") conds.push({ hasFlag: "attacker", flag: "charged" });
  if (p.when === "stationary") conds.push({ not: { hasFlag: "attacker", flag: "moved" } });
  const and = (extra?: Expr): Expr => ({ all: extra ? [...conds, extra] : conds });
  if (p.grant) {
    const effects = weaponRule(system, p.grant);
    return effects && effects.map((e) => ({ ...e, if: and(e.if) }));
  }
  const action: EffectAction | null = p.reroll
    ? { do: "reroll", which: p.reroll }
    : p.by && p.roll === "damage"
      ? { do: "modifyCharacteristic", target: "weapon", characteristic: "D", by: p.by }
      : p.by
        ? { do: "modifyRoll", by: p.by }
        : null;
  return action && p.roll ? [{ when: step(p.roll), if: and(), do: [action] }] : null;
}

function compile(parts: AutoPart[], system: GameSystem): Effect[] | null {
  const out: Effect[] = [];
  for (const p of parts) {
    if (p.kind === "attack") {
      const e = compileAttack(p, system);
      if (!e) return null;
      out.push(...e);
    } else if (p.kind === "fnp")
      out.push({ when: { event: "always" }, do: [{ do: "ignoreDamage", atLeast: p.x }] });
    // Gains and heals run from the trigger (turn.ts), not as effects.
  }
  return out;
}

/**
 * The rule an ability's text describes, or null when any part of it isn't
 * understood (then it stays a reminder, as before).
 */
export function recognize(ability: Pick<Ability, "name" | "text">, system: GameSystem): AbilityAuto | null {
  const text = normalize(ability.text);
  if (!text) return null;
  const { prefix, rest } = readPrefix(text);
  const parts: AutoPart[] = [];
  let trigger: Trigger | undefined;
  for (const s of sentences(rest)) {
    const t = readTrigger(s);
    if (t) {
      if (trigger) return null;
      trigger = t.trigger;
      parts.push(...t.parts);
      continue;
    }
    const read = readAttack(s) ?? readGrant(s) ?? readFnp(s);
    if (!read) return null;
    parts.push(...read);
  }
  if (!parts.length) return null;
  // A trigger is the whole ability; once per battle and auras don't mix with one here.
  if (
    trigger &&
    (parts.some((p) => p.kind !== "gain" && p.kind !== "heal") || prefix.oncePerBattle || prefix.aura)
  )
    return null;
  if (prefix.aura && parts.some((p) => p.kind === "fnp")) return null;
  const effects = compile(parts, system);
  if (!effects) return null;
  const auto: AbilityAuto = { parts, effects };
  if (prefix.whileLeading) auto.whileLeading = true;
  if (prefix.oncePerBattle) auto.oncePerBattle = true;
  if (prefix.aura) auto.aura = prefix.aura;
  if (trigger) {
    const gain = parts.find((p) => p.kind === "gain");
    const heal = parts.find((p) => p.kind === "heal");
    auto.trigger = {
      ...trigger,
      ...(gain ? { gain: { resource: gain.resource, amount: gain.amount } } : {}),
      ...(heal ? { heal: heal.amount } : {}),
    };
  }
  return auto;
}

interface AbilityProposal {
  unitId: string;
  /** Index in the unit's abilities. */
  index: number;
  ability: Ability;
  auto: AbilityAuto;
}

interface Coverage {
  /** Abilities the engine runs: core rules it knows, plus confirmed ones. */
  automated: number;
  total: number;
  /** Rules read from the text, waiting for the player to confirm. */
  proposals: AbilityProposal[];
}

/** Count each distinct ability (by unit and name) once; weapon keyword glossary entries aren't abilities. */
export function coverage(
  units: { id: string; abilities: Ability[] }[],
  system: GameSystem,
  isGlossary: (a: Ability) => boolean = () => false,
): Coverage {
  let automated = 0;
  let total = 0;
  const proposals: AbilityProposal[] = [];
  for (const u of units) {
    const seen = new Set<string>();
    u.abilities.forEach((a, index) => {
      if (seen.has(a.name) || isGlossary(a)) return;
      seen.add(a.name);
      total++;
      if (isAutomated(system, a)) {
        automated++;
        return;
      }
      const auto = recognize(a, system);
      if (auto) proposals.push({ unitId: u.id, index, ability: a, auto });
    });
  }
  return { automated, total, proposals };
}
