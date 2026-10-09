import { die } from "../dice";
import {
  baseOutline,
  baseSizeInches,
  baseToBaseDistance,
  basesWithin,
  distance as centreDistance,
} from "../geometry";
import { modelSight } from "../los";
import { inArc as blockArc } from "../regiment";
import {
  footprintVisibility,
  inFootprint,
  modelDistance,
  segmentCrossesFootprint2D,
  whollyWithin,
} from "../terrain";
import { opposed } from "../teams";
import type { Ability, GameState, Model, TerrainPiece, Unit, WeaponProfile } from "../types";
import { bool, evaluate, num, resolve, type EvalContext } from "./expr";
import type {
  CharacteristicDef,
  Effect,
  EffectAction,
  GameSystem,
  GeoQuery,
  RuleDef,
  RuleRef,
  Value,
} from "./schema";

/**
 * The runtime state model: read-only views of the table that expressions
 * evaluate against. A view is rebuilt from GameState whenever it is needed,
 * so GameState stays the single source of truth and views never go stale.
 *
 *  - Characteristics are read from the imported text ("3+", '24"', "D6")
 *    through the system's CharacteristicDefs and their aliases, so "SV" in a
 *    roster becomes `Sv`, and "BS" or "WS" becomes `skill`.
 *  - Rules come from the system's RuleDefs whose `match` pattern fits a
 *    weapon keyword or an ability, so "Sustained Hits 2" binds sustainedHits
 *    with x = 2.
 *  - Flags are the unit's truthy status entries (moved, charged, ...);
 *    statuses are the flags the system declares as statuses.
 *  - Continuous ("always") effects of bound rules and statuses are folded in:
 *    setFlag, setCharacteristic, modifyCharacteristic, grantKeyword.
 */

export interface ModelView {
  kind: "model";
  id: string;
  unitId: string | undefined;
  owner: string;
  keywords: string[];
  statuses: string[];
  flags: string[];
  rules: RuleRef[];
  woundsLost: number;
  destroyed: boolean;
  /**
   * 1 for a model unlike most of its unit (a sergeant, a special weapon, a
   * character), else 0. Set on a unit view's models; 0 on a lone model view.
   */
  special: number;
  /** Characteristics by system id, e.g. T, Sv, W. */
  [characteristic: string]: unknown;
}

export interface UnitView {
  kind: "unit";
  id: string;
  name: string;
  owner: string;
  keywords: string[];
  statuses: string[];
  flags: string[];
  rules: RuleRef[];
  /** Models still on the table. */
  models: ModelView[];
  startingStrength: number;
  /** Models in the front rank: a ranked block's files, or every model for skirmishers. */
  files: number;
  /** The unit's characteristics are its first model's, as most games read them. */
  [characteristic: string]: unknown;
}

interface WeaponView {
  kind: "weapon";
  id: string;
  name: string;
  /** The weapon kind, e.g. "ranged" or "melee". */
  weaponKind: string;
  keywords: string[];
  flags: string[];
  rules: RuleRef[];
  /** Models of the unit carrying it, once per copy carried. */
  bearers: ModelView[];
  /** Its place on the unit's card, from 1 (FSD's system lines). */
  order: number;
  [characteristic: string]: unknown;
}

type View = ModelView | UnitView | WeaponView;

// ---------------------------------------------------------------------------
// Characteristics
// ---------------------------------------------------------------------------

/**
 * Read an imported characteristic: "3+" → 3, '24"' → 24, "-1" → -1,
 * "D6+1" stays dice text (for dice characteristics), "-" or "N/A" → null.
 */
function parseValue(text: string | number | null | undefined, type: CharacteristicDef["type"]): Value {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return text;
  if (type === "text") return text.trim() && text.trim() !== "-" ? text.trim() : null;
  const t = text.replace(/\s/g, "");
  if (type === "dice" && /^\d*d\d+([+-]\d+)?$/i.test(t)) return t.toUpperCase();
  const m = /^[+-]?\d+(\.\d+)?/.exec(t);
  return m ? Number(m[0]) : null;
}

/**
 * Characteristics already read, by system, kind and profile: the bot and the
 * game review build views of the same profiles hundreds of thousands of times
 * (perf/results.md, #63). Shared: read them, don't change them.
 */
const charsRead = new WeakMap<GameSystem, Map<string, WeakMap<object, Record<string, Value>>>>();
const NO_CHARS = {};

/** Characteristics of one kind (model or weapon) by system id, defaults filled in. Shared: don't change it. */
export function readCharacteristics(
  system: GameSystem,
  of: CharacteristicDef["of"],
  chars: Record<string, string> | undefined,
): Record<string, Value> {
  let byKind = charsRead.get(system);
  if (!byKind) charsRead.set(system, (byKind = new Map()));
  let byChars = byKind.get(of);
  if (!byChars) byKind.set(of, (byChars = new WeakMap()));
  const key = chars ?? NO_CHARS;
  const known = byChars.get(key);
  if (known) return known;
  const out = readFresh(system, of, chars);
  byChars.set(key, out);
  return out;
}

function readFresh(
  system: GameSystem,
  of: CharacteristicDef["of"],
  chars: Record<string, string> | undefined,
): Record<string, Value> {
  const byName = new Map<string, string>();
  for (const [k, v] of Object.entries(chars ?? {})) byName.set(k.toLowerCase(), v);
  const out: Record<string, Value> = {};
  for (const def of system.characteristics) {
    if (def.of !== of) continue;
    let value: Value = null;
    for (const name of [def.id, ...(def.aliases ?? [])]) {
      let raw = byName.get(name.toLowerCase());
      if (raw === undefined) continue;
      if (def.pattern) {
        const m = pattern(def.pattern).exec(raw);
        if (!m) continue;
        raw = m[1] ?? m[0];
      }
      value = parseValue(raw, def.type);
      if (value !== null) break;
    }
    out[def.id] = value ?? def.default ?? null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule binding
// ---------------------------------------------------------------------------

const patternCache = new Map<string, RegExp>();

export function pattern(source: string): RegExp {
  let re = patternCache.get(source);
  if (!re) {
    re = new RegExp(source, "i");
    patternCache.set(source, re);
  }
  return re;
}

/**
 * Bind imported text (weapon keywords, or ability "name text") to the rules
 * whose `match` pattern fits. Only rules that apply to `kind` are tried.
 */
const bound = new WeakMap<RuleDef[], Map<string, RuleRef[]>>();

export function bindRules(rules: RuleDef[], texts: string[], kind: "weapon" | "model" | "unit"): RuleRef[] {
  // The same rules against the same texts bind the same way: views are rebuilt for every table the bot tries.
  let byText = bound.get(rules);
  if (!byText) bound.set(rules, (byText = new Map()));
  const key = `${kind}\u0000${texts.join("\u0000")}`;
  const known = byText.get(key);
  if (known) return [...known];
  const out = bindFresh(rules, texts, kind);
  byText.set(key, out);
  return [...out];
}

function bindFresh(rules: RuleDef[], texts: string[], kind: "weapon" | "model" | "unit"): RuleRef[] {
  const out: RuleRef[] = [];
  for (const rule of rules) {
    if (!rule.match) continue;
    if (rule.appliesTo && !rule.appliesTo.includes(kind)) continue;
    const re = pattern(rule.match);
    for (const text of texts) {
      const m = re.exec(text.trim());
      if (!m) continue;
      const params: Record<string, Value> = {};
      for (const p of rule.params ?? []) {
        const raw = m.groups?.[p.id];
        if (raw !== undefined)
          params[p.id] = p.type === "keyword" || p.type === "text" ? raw : paramValue(raw);
        else if (p.default !== undefined) params[p.id] = p.default;
      }
      out.push(rule.params?.length ? { rule: rule.id, params } : { rule: rule.id });
      // A parameterless rule binds once; parameterised ones once per text (Anti-X for each X).
      if (!rule.params?.length) break;
    }
  }
  return out;
}

function paramValue(raw: string): Value {
  const t = raw.replace(/\s/g, "").toUpperCase();
  return /^-?\d+$/.test(t) ? Number(t) : t;
}

/** A RuleDef with its parameters as an expression scope. */
interface BoundRule {
  def: RuleDef;
  param: Record<string, unknown>;
}

export function lookupRules(system: GameSystem, refs: RuleRef[], extra: RuleDef[] = []): BoundRule[] {
  const out: BoundRule[] = [];
  for (const ref of refs) {
    const def =
      ref.def ?? extra.find((r) => r.id === ref.rule) ?? system.rules.find((r) => r.id === ref.rule);
    if (!def) continue;
    const param: Record<string, unknown> = {};
    for (const p of def.params ?? []) param[p.id] = ref.params?.[p.id] ?? p.default ?? null;
    out.push({ def, param });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface ViewOptions {
  /** Pack or faction rules to bind on top of the system's. */
  rules?: RuleDef[];
}

function abilityTexts(unit: Unit | undefined): string[] {
  // An automated ability runs as its own rule (autoRules), scoped as the player confirmed.
  return (unit?.sheet?.abilities ?? []).filter((a) => !a.auto).map((a) => `${a.name} ${a.text}`.trim());
}

function unitFlags(unit: Unit | undefined): string[] {
  return Object.entries(unit?.status ?? {})
    .filter(([, v]) => v !== false && v !== 0 && v !== null)
    .map(([k]) => k);
}

export function modelView(
  state: GameState,
  system: GameSystem,
  model: Model,
  opts: ViewOptions = {},
): ModelView {
  const unit = model.unitId ? state.units[model.unitId] : undefined;
  const rules = opts.rules?.length ? [...system.rules, ...opts.rules] : system.rules;
  const flags = unitFlags(unit);
  const view: ModelView = {
    ...readCharacteristics(system, "model", model.profile?.chars),
    kind: "model",
    id: model.id,
    unitId: model.unitId,
    owner: model.owner,
    keywords: [...(unit?.sheet?.keywords ?? [])],
    statuses: statusesOf(system, flags),
    flags,
    rules: bindRules(rules, abilityTexts(unit), "model"),
    woundsLost: model.woundsLost ?? 0,
    destroyed: !!model.destroyed,
    special: 0,
  };
  Object.defineProperty(view, "source", { value: model, enumerable: false });
  return applyContinuous(system, view, opts.rules);
}

/** What makes models interchangeable: the same profile and the same weapons. */
export function loadoutKey(model: { profile?: { name?: string }; weapons?: string[] } | undefined): string {
  return `${model?.profile?.name ?? ""}|${[...(model?.weapons ?? [])].sort().join(",")}`;
}

/** The commonest loadout among these models (the unit's ordinary models). */
export function commonLoadout(
  models: ({ profile?: { name?: string }; weapons?: string[] } | undefined)[],
): string {
  const counts = new Map<string, number>();
  for (const m of models) counts.set(loadoutKey(m), (counts.get(loadoutKey(m)) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

function majority(state: GameState, models: ModelView[]): ModelView | undefined {
  const counts = new Map<string, number>();
  const name = (m: ModelView) => state.models[m.id]?.profile?.name ?? "";
  for (const m of models) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1);
  let best = models[0];
  for (const m of models) if ((counts.get(name(m)) ?? 0) > (counts.get(name(best!)) ?? 0)) best = m;
  return best;
}

/** An automated ability's effects as an inline rule named after the ability. */
function autoRef(a: Ability): RuleRef {
  const id = `auto:${a.name}`;
  return { rule: id, def: { id, name: a.name, effects: a.auto?.effects ?? [] } };
}

/** Whether an automated ability is switched on for its unit right now. */
export function autoActive(unit: Unit, a: Ability): boolean {
  if (!a.auto) return false;
  if (a.auto.whileLeading && !unit.status?.attached) return false;
  if (a.auto.oncePerBattle && !unit.status?.[`auto.${a.name}`]) return false;
  return true;
}

/** A unit has every keyword in a phrase such as "Adeptus Astartes Infantry". */
export function hasKeywordPhrase(unit: Unit, phrase: string): boolean {
  let rest = ` ${phrase.toLowerCase().replace(/\s+/g, " ")} `;
  const kws = [...(unit.sheet?.keywords ?? [])]
    .map((k) => k.toLowerCase())
    .sort((a, b) => b.length - a.length);
  for (const k of kws) rest = rest.replace(` ${k} `, " ");
  return rest.trim() === "";
}

function unitsGap(state: GameState, a: Unit, b: Unit): number {
  let best = Infinity;
  for (const i of a.modelIds) {
    const m = state.models[i];
    if (!m || m.destroyed) continue;
    for (const j of b.modelIds) {
      const n = state.models[j];
      if (n && !n.destroyed) best = Math.min(best, baseToBaseDistance(m, n));
    }
  }
  return best;
}

/**
 * Rules from abilities the player automated (#38): the unit's own that are
 * on, and auras of units in range of it (its own aura included).
 */
function autoRules(state: GameState, unit: Unit): RuleRef[] {
  const out: RuleRef[] = [];
  for (const a of unit.sheet?.abilities ?? [])
    if (a.auto && !a.auto.aura && !a.auto.trigger && autoActive(unit, a)) out.push(autoRef(a));
  // The owner's army (#49): confirmed detachment rules run for every unit, a stratagem for the phase it was used.
  const army = state.armies?.[unit.owner];
  for (const r of army?.rules ?? [])
    if (r.auto && !r.auto.aura && !r.auto.trigger && autoActive(unit, r)) out.push(autoRef(r));
  for (const s of army?.stratagems ?? [])
    if (s.auto && unit.status?.[`strat.${s.id}`]) out.push(autoRef({ name: s.name, text: "", auto: s.auto }));
  for (const other of Object.values(state.units)) {
    for (const a of other.sheet?.abilities ?? []) {
      const aura = a.auto?.aura;
      if (!aura || !autoActive(other, a)) continue;
      if ((aura.side === "enemy") !== opposed(state, other.owner, unit.owner)) continue;
      if (aura.keyword && !hasKeywordPhrase(unit, aura.keyword)) continue;
      if (other.id !== unit.id && !(unitsGap(state, other, unit) <= aura.range)) continue;
      out.push(autoRef(a));
    }
  }
  return out;
}

/**
 * Views asked for again and again of one table (each eligibility check, each
 * expression): kept per state and unit, since neither changes once made (#51).
 */
const viewMemo = new WeakMap<GameState, WeakMap<Unit, { system: GameSystem; view: UnitView }>>();

export function unitView(state: GameState, system: GameSystem, unit: Unit, opts: ViewOptions = {}): UnitView {
  if (opts.rules) return makeUnitView(state, system, unit, opts);
  let byUnit = viewMemo.get(state);
  if (!byUnit) viewMemo.set(state, (byUnit = new WeakMap()));
  const known = byUnit.get(unit);
  if (known && known.system === system) return known.view;
  const view = makeUnitView(state, system, unit, opts);
  byUnit.set(unit, { system, view });
  return view;
}

function makeUnitView(state: GameState, system: GameSystem, unit: Unit, opts: ViewOptions = {}): UnitView {
  const models = unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [modelView(state, system, m, opts)] : [];
  });
  const common = commonLoadout(models.map((m) => state.models[m.id]));
  for (const m of models) m.special = loadoutKey(state.models[m.id]) === common ? 0 : 1;
  const rules = opts.rules?.length ? [...system.rules, ...opts.rules] : system.rules;
  const flags = unitFlags(unit);
  // Read from the commonest profile (most games use the majority's Toughness), else the first model.
  const first = majority(state, models);
  const chars = first
    ? Object.fromEntries(
        system.characteristics.filter((c) => c.of === "model").map((c) => [c.id, first[c.id]]),
      )
    : readCharacteristics(system, "model", undefined);
  const view: UnitView = {
    ...chars,
    ...readCharacteristics(system, "unit", undefined),
    kind: "unit",
    id: unit.id,
    name: unit.name,
    owner: unit.owner,
    keywords: [...(unit.sheet?.keywords ?? [])],
    statuses: statusesOf(system, flags),
    flags,
    rules: [...bindRules(rules, abilityTexts(unit), "unit"), ...autoRules(state, unit)],
    models,
    files: unit.formation.kind === "ranked" ? Math.min(unit.formation.files, models.length) : models.length,
    startingStrength: unit.modelIds.length,
  };
  Object.defineProperty(view, "source", { value: unit, enumerable: false });
  // Statuses already changed the models' characteristics the unit reads from: not twice (#55).
  return applyContinuous(system, view, opts.rules, modelChars(system));
}

/** The characteristics a unit view copies from its models. */
function modelChars(system: GameSystem): Set<string> {
  return new Set(system.characteristics.filter((c) => c.of === "model").map((c) => c.id));
}

export function weaponView(
  state: GameState,
  system: GameSystem,
  unit: Unit,
  weapon: WeaponProfile,
  opts: ViewOptions = {},
): WeaponView {
  const rules = opts.rules?.length ? [...system.rules, ...opts.rules] : system.rules;
  const bearers = unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    if (!m || m.destroyed) return [];
    const copies = (m.weapons ?? []).filter((w) => w === weapon.id).length;
    const view = modelView(state, system, m, opts);
    return Array.from({ length: copies }, () => view);
  });
  const view: WeaponView = {
    ...readCharacteristics(system, "weapon", weapon.chars),
    kind: "weapon",
    id: weapon.id,
    name: weapon.name,
    weaponKind: weapon.kind,
    keywords: [...weapon.keywords],
    flags: [],
    rules: bindRules(rules, weapon.keywords, "weapon"),
    bearers,
    order: Object.keys(unit.sheet?.weapons ?? {}).indexOf(weapon.id) + 1,
  };
  return applyContinuous(system, view, opts.rules);
}

/** The model or unit a view was built from, for geometry. */
function sourceOf(view: unknown): Model | Unit | undefined {
  return view && typeof view === "object" ? (view as { source?: Model | Unit }).source : undefined;
}

function statusesOf(system: GameSystem, flags: string[]): string[] {
  const ids = new Set((system.statuses ?? []).map((s) => s.id));
  return flags.filter((f) => ids.has(f));
}

/** Fold "always" effects of the view's rules and statuses into it. */
function applyContinuous<V extends View>(
  system: GameSystem,
  view: V,
  extra?: RuleDef[],
  /** Characteristics statuses have already changed (on the models a unit view reads them from). */
  done?: Set<string>,
): V {
  const sources: { effects: Effect[]; param: Record<string, unknown>; status?: boolean }[] = lookupRules(
    system,
    view.rules,
    extra,
  ).map((b) => ({ effects: b.def.effects, param: b.param }));
  if ("statuses" in view)
    for (const s of system.statuses ?? [])
      if ((view.statuses as string[]).includes(s.id) && s.effects)
        sources.push({ effects: s.effects, param: {}, status: true });
  const source = sourceOf(view);
  let out = view;
  for (const { effects, param, status } of sources) {
    for (const effect of effects) {
      if (effect.when.event !== "always") continue;
      const ctx: EvalContext = { scope: { self: out, param, weapon: out } };
      if (effect.if !== undefined && !safeBool(effect.if, ctx)) continue;
      for (const action of effect.do) {
        if (status && done && action.do === "modifyCharacteristic" && done.has(action.characteristic))
          continue;
        out = applyToView(out, action, ctx);
      }
    }
  }
  if (out !== view && source) Object.defineProperty(out, "source", { value: source, enumerable: false });
  return out;
}

function applyToView<V extends View>(view: V, action: EffectAction, ctx: EvalContext): V {
  const own =
    !("target" in action) || !action.target || action.target === "self" || action.target === "weapon";
  if (!own) return view;
  switch (action.do) {
    case "setFlag": {
      const flags = action.value
        ? [...new Set([...view.flags, action.flag])]
        : view.flags.filter((f) => f !== action.flag);
      return { ...view, flags };
    }
    case "grantKeyword":
      return { ...view, keywords: [...view.keywords, action.keyword] };
    case "setCharacteristic":
      return { ...view, [action.characteristic]: evaluate(action.to, ctx) };
    case "modifyCharacteristic":
      return {
        ...view,
        [action.characteristic]: addDice(view[action.characteristic] as Value, diceTerm(action.by, ctx)),
      };
    default:
      return view;
  }
}

function safeBool(expr: Parameters<typeof bool>[0], ctx: EvalContext): boolean {
  try {
    return bool(expr, ctx);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dice sums: "2D6+D3+1" as data, so modifiers can be added before rolling
// ---------------------------------------------------------------------------

/** Dice of one size, plus a flat part (sides 0). */
export interface DiceTerm {
  count: number;
  sides: number;
}

export type DiceSum = DiceTerm[];

export function parseDiceSum(text: Value | undefined): DiceSum {
  if (text === null || text === undefined) return [];
  if (typeof text === "number") return text ? [{ count: text, sides: 0 }] : [];
  const out: DiceSum = [];
  const t = text.replace(/\s/g, "").toUpperCase();
  if (!/^[+-]?(\d*D\d+|\d+)([+-](\d*D\d+|\d+))*$/.test(t))
    throw new Error(`Not a dice expression: "${text}"`);
  for (const m of t.matchAll(/([+-]?)(?:(\d*)D(\d+)|(\d+))/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3]) out.push({ count: sign * (m[2] ? Number(m[2]) : 1), sides: Number(m[3]) });
    else out.push({ count: sign * Number(m[4]), sides: 0 });
  }
  return normalise(out);
}

function normalise(sum: DiceSum): DiceSum {
  const by = new Map<number, number>();
  for (const t of sum) by.set(t.sides, (by.get(t.sides) ?? 0) + t.count);
  return [...by.entries()]
    .filter(([, c]) => c !== 0)
    .sort((a, b) => (a[0] === 0 ? 1 : b[0] === 0 ? -1 : b[0] - a[0]))
    .map(([sides, count]) => ({ count, sides }));
}

function sumDice(...sums: DiceSum[]): DiceSum {
  return normalise(sums.flat());
}

export function formatDice(sum: DiceSum): string {
  if (!sum.length) return "0";
  return sum
    .map((t, i) => {
      const body = t.sides
        ? `${Math.abs(t.count) === 1 ? "" : Math.abs(t.count)}D${t.sides}`
        : `${Math.abs(t.count)}`;
      return `${t.count < 0 ? "-" : i ? "+" : ""}${body}`;
    })
    .join("");
}

/** Roll a dice sum, one die at a time in term order. */
export function rollSum(sum: DiceSum, rng: () => number): { rolls: number[]; total: number } {
  const rolls: number[] = [];
  let total = 0;
  for (const t of sum) {
    if (!t.sides) {
      total += t.count;
      continue;
    }
    for (let i = 0; i < Math.abs(t.count); i++) {
      const r = die(rng, t.sides);
      rolls.push(r);
      total += Math.sign(t.count) * r;
    }
  }
  return { rolls, total };
}

export function averageSum(sum: DiceSum): number {
  return sum.reduce((n, t) => n + t.count * (t.sides ? (t.sides + 1) / 2 : 1), 0);
}

function addDice(value: Value, by: DiceSum): Value {
  if (!by.length) return value;
  const sum = sumDice(parseDiceSum(value ?? 0), by);
  return sum.every((t) => t.sides === 0) ? sum.reduce((n, t) => n + t.count, 0) : formatDice(sum);
}

/**
 * An expression as unrolled dice: `{ dice: "D6" }` or a ref to a dice
 * characteristic stays dice; anything else is evaluated as a number. Sums
 * (`op: "+"`) keep their dice.
 */
export function diceTerm(expr: Parameters<typeof evaluate>[0], ctx: EvalContext): DiceSum {
  if (typeof expr === "object" && expr !== null) {
    if ("dice" in expr) {
      const inner = expr.dice;
      if (typeof inner === "string") return parseDiceSum(inner);
      if (typeof inner === "object" && inner !== null && "ref" in inner) {
        const v = resolve(inner.ref, ctx);
        if (typeof v === "string" || typeof v === "number" || v === null) return parseDiceSum(v as Value);
      }
      return parseDiceSum(num(inner, ctx));
    }
    if ("ref" in expr) {
      const v = resolve(expr.ref, ctx);
      if (typeof v === "string") return parseDiceSum(v);
    }
    if ("op" in expr && expr.op === "+") return sumDice(...expr.args.map((a) => diceTerm(a, ctx)));
  }
  return parseDiceSum(num(expr, ctx));
}

// ---------------------------------------------------------------------------
// Geometry over views
// ---------------------------------------------------------------------------

function modelsOf(view: unknown, state: GameState): Model[] {
  const src = sourceOf(view);
  if (!src) return [];
  if ("modelIds" in src)
    return src.modelIds.flatMap((id) => {
      const m = state.models[id];
      return m && !m.destroyed ? [m] : [];
    });
  return [src];
}

/** Inches in one of the system's distance units (FSD's DU is 3"). */
export function inchesPerUnit(system: GameSystem | undefined): number {
  const u = system?.units;
  return u && typeof u === "object" ? u.inches : u === "cm" ? 1 / 2.54 : 1;
}

/**
 * Geometry queries answered from the table: distance and visibility between
 * any two models or units (closest pair), arcs and cover. Distances are base
 * edge to base edge in 3D unless the query asks for centres or one axis, in
 * the system's distance unit. Other queries throw until the engine supports
 * them, so callers can fall back to supplied facts.
 */
export function tableGeometry(state: GameState, system?: GameSystem): NonNullable<EvalContext["geometry"]> {
  const scale = inchesPerUnit(system);
  return (query: GeoQuery, ctx: EvalContext) => {
    if (query.kind === "distance") {
      const a = modelsOf(resolve(query.from, ctx), state);
      const b = modelsOf(resolve(query.to, ctx), state);
      let best = Infinity;
      for (const x of a)
        for (const y of b) {
          const d =
            query.axis === "vertical"
              ? Math.abs((x.z ?? 0) - (y.z ?? 0))
              : query.measure === "centre"
                ? centreDistance(x.position, y.position)
                : query.axis === "horizontal"
                  ? baseToBaseDistance(x, y)
                  : modelDistance(x, y);
          best = Math.min(best, d);
        }
      return best / scale;
    }
    if (query.kind === "visible") {
      const a = modelsOf(resolve(query.from, ctx), state);
      const b = modelsOf(resolve(query.to, ctx), state);
      const ignore = ownUnits(state, [...a, ...b]);
      return a.some((x) =>
        b.some((y) => {
          const modelsBlock = query.models !== false && state.settings.modelsBlock;
          const s = modelSight(state, x, y, { modelsBlock, ignore, allAround: query.allAround });
          return query.fully ? s.fully : s.visible;
        }),
      );
    }
    if (query.kind === "inArc") {
      // Some model of `to` lies in the arc of `from`'s first model, measured from its facing.
      const arc = system?.arcs?.find((x) => x.id === query.arc);
      const from = modelsOf(resolve(query.from, ctx), state)[0];
      if (!arc || !from) return false;
      // A ranked block's arcs run from its corners, and a unit counts by the
      // centre of its front edge (rank-and-flank flank and rear charges).
      const fromSrc = sourceOf(resolve(query.from, ctx));
      const toSrc = sourceOf(resolve(query.to, ctx));
      if (fromSrc && toSrc && "modelIds" in fromSrc && "modelIds" in toSrc) {
        const side = blockArc(state, fromSrc, toSrc);
        if (side) {
          const mid = ((((arc.from + arc.to) / 2) % 360) + 360) % 360;
          // The arcs' angles run clockwise from ahead as below, which the block code calls the other side.
          const named = mid < 45 || mid >= 315 ? "front" : mid < 135 ? "left" : mid < 225 ? "rear" : "right";
          return side === named;
        }
      }
      return modelsOf(resolve(query.to, ctx), state).some((m) => {
        const dx = m.position.x - from.position.x;
        const dy = m.position.y - from.position.y;
        // Facing 0 looks along +y; angles run clockwise from straight ahead.
        let deg = ((Math.atan2(dx, dy) - from.facing) * 180) / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        const lo = ((arc.from % 360) + 360) % 360;
        const hi = lo + (arc.to - arc.from);
        return (deg >= lo && deg <= hi) || (deg + 360 >= lo && deg + 360 <= hi);
      });
    }
    if (query.kind === "cover")
      return inCover(state, system, resolve(query.from, ctx), resolve(query.to, ctx));
    if (query.kind === "coverShare")
      return coverShare(state, system, resolve(query.from, ctx), resolve(query.to, ctx));
    if (query.kind === "inArea") {
      // Some model (every model, `wholly`) of the subject is in the area.
      const models = modelsOf(resolve(query.subject, ctx), state);
      const test = areaTest(state, query.area, models[0]);
      if (!models.length || !test) return false;
      return query.wholly ? models.every((m) => test(m, true)) : models.some((m) => test(m, false));
    }
    if (query.kind === "crosses") {
      // The line between the closest pair of centres passes over terrain of the category.
      const a = modelsOf(resolve(query.from, ctx), state);
      const b = modelsOf(resolve(query.to, ctx), state);
      let pair: [Model, Model] | null = null;
      for (const x of a)
        for (const y of b)
          if (
            !pair ||
            centreDistance(x.position, y.position) < centreDistance(pair[0].position, pair[1].position)
          )
            pair = [x, y];
      if (!pair) return false;
      const [x, y] = pair;
      return state.terrain.some(
        (p) => p.category === query.terrainCategory && segmentCrossesFootprint2D(p, x.position, y.position),
      );
    }
    if (query.kind === "elevation") {
      // How far the highest model of `from` stands above the lowest of `to`.
      const a = modelsOf(resolve(query.from, ctx), state);
      const b = modelsOf(resolve(query.to, ctx), state);
      if (!a.length || !b.length) return 0;
      return (Math.max(...a.map((m) => m.z ?? 0)) - Math.min(...b.map((m) => m.z ?? 0))) / scale;
    }
    if (query.kind === "objective") return nearObjective(state, system, query, resolve(query.subject, ctx));
    throw new Error(`Geometry query "${(query as { kind: string }).kind}" is not supported`);
  };
}

/** The "objective" query: some model of the subject in range of a marker (its side controls). */
function nearObjective(
  state: GameState,
  system: GameSystem | undefined,
  query: Extract<GeoQuery, { kind: "objective" }>,
  subject: unknown,
): boolean {
  const mine = modelsOf(subject, state);
  if (!mine.length) return false;
  const c = system?.constants ?? {};
  const range = (query.range ?? c.objectiveRange ?? 3) * inchesPerUnit(system);
  const marker = (o: { position: Model["position"] }) =>
    ({
      position: o.position,
      facing: 0,
      base: { shape: "round", diameterMm: c.objectiveMarkerMm ?? 0 },
    }) as Model;
  const near = (m: Model, o: Model) => basesWithin(m, o, range + 1e-6);
  const owner = mine[0]!.owner;
  return state.objectives.some((o) => {
    const at = marker(o);
    if (!mine.some((m) => near(m, at))) return false;
    if (!query.controls || !system) return true;
    // Each side's total of the characteristic over its models in range (statuses applied).
    let ours = 0;
    const theirs: Record<string, number> = {};
    for (const unit of Object.values(state.units))
      for (const m of unitView(state, system, unit).models) {
        const model = state.models[m.id];
        if (!model || !near(model, at)) continue;
        const v = typeof m[query.controls] === "number" ? (m[query.controls] as number) : 1;
        if (!opposed(state, owner, m.owner)) ours += v;
        else {
          const side = String(state.players[m.owner]?.seat ?? m.owner);
          theirs[side] = (theirs[side] ?? 0) + v;
        }
      }
    return ours > 0 && Object.values(theirs).every((v) => v < ours);
  });
}

/**
 * An area named by a ref: "terrain.<category>" (any piece of it),
 * "zone.own", "zone.enemy" or "zone.<seat>" (deployment zones, by the
 * subject's owner). A model is in it if its centre is (or, wholly, its base).
 */
function areaTest(
  state: GameState,
  area: string,
  subject: Model | undefined,
): ((m: Model, wholly: boolean) => boolean) | null {
  const [kind, which] = area.split(".");
  if (kind === "terrain" && which) {
    const pieces = state.terrain.filter((p) => p.category === which);
    return (m, wholly) => pieces.some((p) => (wholly ? whollyWithin(p, m) : inFootprint(p, m.position)));
  }
  if (kind === "zone" && which) {
    const seat = subject ? state.players[subject.owner]?.seat : undefined;
    const zones = state.zones.filter((z) =>
      which === "own" ? z.seat === seat : which === "enemy" ? z.seat !== seat : z.seat === Number(which),
    );
    const inside = (p: { x: number; y: number }) => zones.some((z) => inPolygon(z.points, p));
    return (m, wholly) => (wholly ? baseOutline(m).every(inside) && inside(m.position) : inside(m.position));
  }
  return null;
}

/** Point in polygon, by ray casting. */
function inPolygon(points: { x: number; y: number }[], p: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Models of the units these models belong to, which never block each other's sight. */
function ownUnits(state: GameState, models: Model[]): Set<string> {
  const out = new Set<string>();
  for (const m of models) {
    const u = m.unitId ? state.units[m.unitId] : undefined;
    for (const id of u?.modelIds ?? [m.id]) out.add(id);
  }
  return out;
}

/**
 * Cover by the system's terrain categories: a target model `from` can see is
 * in cover if it stands in or touches a piece whose category gives cover to
 * its keywords, or is seen only past an obscuring piece.
 */
function inCover(state: GameState, system: GameSystem | undefined, from: unknown, to: unknown): boolean {
  return coverOf(state, system, from, to).covered > 0;
}

/** Of the target's models the shooters can see, the share in cover (0 when none is seen). */
function coverShare(state: GameState, system: GameSystem | undefined, from: unknown, to: unknown): number {
  const { seen, covered } = coverOf(state, system, from, to, true);
  return seen ? covered / seen : 0;
}

/**
 * Cover asked about again and again while one attack resolves (every step's
 * effects check it), so it is kept until the models or the terrain change.
 */
const coverMemo = new WeakMap<
  object,
  { terrain: unknown; settings: unknown; seen: Map<string, { seen: number; covered: number }> }
>();

/** How many of the target's models the shooters see, and how many of those are in cover (`all`: count every one). */
function coverOf(
  state: GameState,
  system: GameSystem | undefined,
  from: unknown,
  to: unknown,
  all = false,
): { seen: number; covered: number } {
  const shooters = modelsOf(from, state);
  const targets = modelsOf(to, state);
  let memo = coverMemo.get(state.models);
  if (!memo || memo.terrain !== state.terrain || memo.settings !== state.settings) {
    memo = { terrain: state.terrain, settings: state.settings, seen: new Map() };
    coverMemo.set(state.models, memo);
  }
  const key = `${system?.id}|${all}|${shooters.map((m) => m.id).join()}|${targets.map((m) => m.id).join()}|${((to as { keywords?: string[] })?.keywords ?? []).join()}`;
  const known = memo.seen.get(key);
  if (known) return known;
  const found = coverFrom(state, system, shooters, targets, to, all);
  memo.seen.set(key, found);
  return found;
}

function coverFrom(
  state: GameState,
  system: GameSystem | undefined,
  shooters: Model[],
  targets: Model[],
  to: unknown,
  all: boolean,
): { seen: number; covered: number } {
  const ignore = ownUnits(state, [...shooters, ...targets]);
  const keywords = ((to as { keywords?: string[] })?.keywords ?? []).map((k) => k.toUpperCase());
  const categories = new Map((system?.terrain ?? []).map((c) => [c.id, c]));
  const givesCover = (piece: TerrainPiece) => {
    const c = categories.get(piece.category);
    if (!c?.cover) return false;
    return !c.coverFor || c.coverFor.some((k) => keywords.includes(k.toUpperCase()));
  };
  let seen = 0;
  let covered = 0;
  for (const t of targets) {
    const r = Math.max(baseSizeInches(t.base).width, baseSizeInches(t.base).depth) / 2;
    const sights = shooters.map((s) =>
      modelSight(state, s, t, { modelsBlock: state.settings.modelsBlock, ignore }),
    );
    if (!sights.some((x) => x.visible)) continue;
    seen++;
    if (
      state.terrain.some(
        (p) => givesCover(p) && !categories.get(p.category)?.coverWhenHiding && inFootprint(p, t.position, r),
      ) ||
      sights.some(
        (x) => x.visible && x.obscuredBy.some((p) => footprintVisibility(p) === "obscuring" || givesCover(p)),
      )
    ) {
      covered++;
      if (!all) break;
    }
  }
  return { seen, covered };
}
