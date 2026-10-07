import { baseSizeInches, baseToBaseDistance, distance as centreDistance } from "../geometry";
import { modelSight } from "../los";
import { footprintVisibility, inFootprint, modelDistance } from "../terrain";
import type { GameState, Model, TerrainPiece, Unit, WeaponProfile } from "../types";
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
  /** The unit's characteristics are its first model's, as most games read them. */
  [characteristic: string]: unknown;
}

export interface WeaponView {
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
  [characteristic: string]: unknown;
}

export type View = ModelView | UnitView | WeaponView;

// ---------------------------------------------------------------------------
// Characteristics
// ---------------------------------------------------------------------------

/**
 * Read an imported characteristic: "3+" → 3, '24"' → 24, "-1" → -1,
 * "D6+1" stays dice text (for dice characteristics), "-" or "N/A" → null.
 */
export function parseValue(text: string | number | null | undefined, type: CharacteristicDef["type"]): Value {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return text;
  if (type === "text") return text.trim() && text.trim() !== "-" ? text.trim() : null;
  const t = text.replace(/\s/g, "");
  if (type === "dice" && /^\d*d\d+([+-]\d+)?$/i.test(t)) return t.toUpperCase();
  const m = /^[+-]?\d+(\.\d+)?/.exec(t);
  return m ? Number(m[0]) : null;
}

/** Characteristics of one kind (model or weapon) by system id, defaults filled in. */
export function readCharacteristics(
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
export function bindRules(rules: RuleDef[], texts: string[], kind: "weapon" | "model" | "unit"): RuleRef[] {
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
export interface BoundRule {
  def: RuleDef;
  param: Record<string, unknown>;
}

export function lookupRules(system: GameSystem, refs: RuleRef[], extra: RuleDef[] = []): BoundRule[] {
  const out: BoundRule[] = [];
  for (const ref of refs) {
    const def = extra.find((r) => r.id === ref.rule) ?? system.rules.find((r) => r.id === ref.rule);
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

export interface ViewOptions {
  /** Pack or faction rules to bind on top of the system's. */
  rules?: RuleDef[];
}

function abilityTexts(unit: Unit | undefined): string[] {
  return (unit?.sheet?.abilities ?? []).map((a) => `${a.name} ${a.text}`.trim());
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
  const rules = [...system.rules, ...(opts.rules ?? [])];
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
  };
  Object.defineProperty(view, "source", { value: model, enumerable: false });
  return applyContinuous(system, view, opts.rules);
}

export function unitView(state: GameState, system: GameSystem, unit: Unit, opts: ViewOptions = {}): UnitView {
  const models = unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [modelView(state, system, m, opts)] : [];
  });
  const rules = [...system.rules, ...(opts.rules ?? [])];
  const flags = unitFlags(unit);
  const first = models[0];
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
    rules: bindRules(rules, abilityTexts(unit), "unit"),
    models,
    startingStrength: unit.modelIds.length,
  };
  Object.defineProperty(view, "source", { value: unit, enumerable: false });
  return applyContinuous(system, view, opts.rules);
}

export function weaponView(
  state: GameState,
  system: GameSystem,
  unit: Unit,
  weapon: WeaponProfile,
  opts: ViewOptions = {},
): WeaponView {
  const rules = [...system.rules, ...(opts.rules ?? [])];
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
  };
  return applyContinuous(system, view, opts.rules);
}

/** The model or unit a view was built from, for geometry. */
export function sourceOf(view: unknown): Model | Unit | undefined {
  return view && typeof view === "object" ? (view as { source?: Model | Unit }).source : undefined;
}

function statusesOf(system: GameSystem, flags: string[]): string[] {
  const ids = new Set((system.statuses ?? []).map((s) => s.id));
  return flags.filter((f) => ids.has(f));
}

/** Fold "always" effects of the view's rules and statuses into it. */
function applyContinuous<V extends View>(system: GameSystem, view: V, extra?: RuleDef[]): V {
  const sources: { effects: Effect[]; param: Record<string, unknown> }[] = lookupRules(
    system,
    view.rules,
    extra,
  ).map((b) => ({ effects: b.def.effects, param: b.param }));
  if ("statuses" in view)
    for (const s of system.statuses ?? [])
      if ((view.statuses as string[]).includes(s.id) && s.effects)
        sources.push({ effects: s.effects, param: {} });
  const source = sourceOf(view);
  let out = view;
  for (const { effects, param } of sources) {
    for (const effect of effects) {
      if (effect.when.event !== "always") continue;
      const ctx: EvalContext = { scope: { self: out, param, weapon: out } };
      if (effect.if !== undefined && !safeBool(effect.if, ctx)) continue;
      for (const action of effect.do) out = applyToView(out, action, ctx);
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

export function sumDice(...sums: DiceSum[]): DiceSum {
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
      const r = 1 + Math.floor(rng() * t.sides);
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
          const s = modelSight(state, x, y, { modelsBlock: state.settings.modelsBlock, ignore });
          return query.fully ? s.fully : s.visible;
        }),
      );
    }
    if (query.kind === "inArc") {
      // Some model of `to` lies in the arc of `from`'s first model, measured from its facing.
      const arc = system?.arcs?.find((x) => x.id === query.arc);
      const from = modelsOf(resolve(query.from, ctx), state)[0];
      if (!arc || !from) return false;
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
    throw new Error(`Geometry query "${query.kind}" is not supported yet`);
  };
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
  const shooters = modelsOf(from, state);
  const targets = modelsOf(to, state);
  const ignore = ownUnits(state, [...shooters, ...targets]);
  const keywords = ((to as { keywords?: string[] })?.keywords ?? []).map((k) => k.toUpperCase());
  const categories = new Map((system?.terrain ?? []).map((c) => [c.id, c]));
  const givesCover = (piece: TerrainPiece) => {
    const c = categories.get(piece.category);
    if (!c?.cover) return false;
    return !c.coverFor || c.coverFor.some((k) => keywords.includes(k.toUpperCase()));
  };
  return targets.some((t) => {
    const r = Math.max(baseSizeInches(t.base).width, baseSizeInches(t.base).depth) / 2;
    const seen = shooters.some(
      (s) => modelSight(state, s, t, { modelsBlock: state.settings.modelsBlock, ignore }).visible,
    );
    if (!seen) return false;
    if (state.terrain.some((p) => givesCover(p) && inFootprint(p, t.position, r))) return true;
    return shooters.some((s) => {
      const sight = modelSight(state, s, t, { modelsBlock: state.settings.modelsBlock, ignore });
      return (
        sight.visible && sight.obscuredBy.some((p) => footprintVisibility(p) === "obscuring" || givesCover(p))
      );
    });
  });
}
