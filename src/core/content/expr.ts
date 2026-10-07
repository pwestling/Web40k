import { averageDice, parseDice, rollDice } from "../dice";
import type { Rng } from "../actions";
import type { Effect, EventPattern, Expr, GeoQuery, TableDef } from "./schema";

/**
 * Evaluates the JSON expression language from schema.ts. Pure: geometry and
 * randomness come in through the context, so every peer gets the same answer.
 */

/**
 * `scope` holds the roles an expression can refer to ("weapon", "target",
 * "param", "event", ...). Objects may carry `keywords`, `statuses` and
 * `flags` string arrays for the has* tests.
 */
export interface EvalContext {
  scope: Record<string, unknown>;
  tables?: Record<string, TableDef>;
  /** Without an rng, dice evaluate to their average. */
  rng?: Rng;
  geometry?: (query: GeoQuery, ctx: EvalContext) => number | boolean;
}

export type ExprValue = number | boolean;

export function evaluate(expr: Expr, ctx: EvalContext): ExprValue {
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if ("ref" in expr) return toValue(resolve(expr.ref, ctx), expr.ref);
  if ("dice" in expr) {
    const inner = expr.dice;
    const named = typeof inner === "object" && "ref" in inner ? resolve(inner.ref, ctx) : undefined;
    const text =
      typeof inner === "string" ? inner : typeof named === "string" ? named : String(num(inner, ctx));
    const parsed = parseDice(text);
    return ctx.rng ? rollDice(parsed, ctx.rng).total : averageDice(parsed);
  }
  if ("op" in expr) {
    const xs = expr.args.map((a) => num(a, ctx));
    const first = xs[0] ?? 0;
    const rest = xs.slice(1);
    switch (expr.op) {
      case "+":
        return xs.reduce((a, b) => a + b, 0);
      case "-":
        return xs.length === 1 ? -first : rest.reduce((a, b) => a - b, first);
      case "*":
        return xs.reduce((a, b) => a * b, 1);
      case "/":
        return rest.reduce((a, b) => a / b, first);
      case "min":
        return Math.min(...xs);
      case "max":
        return Math.max(...xs);
      case "floor":
        return Math.floor(first);
      case "ceil":
        return Math.ceil(first);
      case "half":
        return Math.ceil(first / 2);
    }
  }
  if ("cmp" in expr) {
    const a = num(expr.a, ctx);
    const b = num(expr.b, ctx);
    switch (expr.cmp) {
      case ">=":
        return a >= b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      case "<":
        return a < b;
      case "==":
        return a === b;
      case "!=":
        return a !== b;
    }
  }
  if ("all" in expr) return expr.all.every((e) => bool(e, ctx));
  if ("any" in expr) return expr.any.some((e) => bool(e, ctx));
  if ("not" in expr) return !bool(expr.not, ctx);
  if ("if" in expr) return evaluate(bool(expr.if, ctx) ? expr.then : expr.else, ctx);
  if ("cases" in expr) {
    const hit = expr.cases.find((c) => bool(c.when, ctx));
    return evaluate(hit ? hit.then : expr.else, ctx);
  }
  if ("table" in expr) {
    const table = ctx.tables?.[expr.table];
    if (!table) throw new Error(`Unknown table "${expr.table}"`);
    const row = headerIndex(table.rows, num(expr.row, ctx));
    const col = table.cols && expr.col !== undefined ? headerIndex(table.cols, num(expr.col, ctx)) : 0;
    const value = table.values[row]?.[col];
    if (value === null || value === undefined) throw new Error(`No entry in table "${expr.table}"`);
    return value;
  }
  if ("hasKeyword" in expr) {
    const kw = typeof expr.keyword === "string" ? expr.keyword : resolve(expr.keyword.ref, ctx);
    if (typeof kw !== "string")
      throw new Error(`Keyword parameter is not text: ${JSON.stringify(expr.keyword)}`);
    const want = kw.toUpperCase();
    return tags(resolve(expr.hasKeyword, ctx), "keywords").some((k) => k.toUpperCase() === want);
  }
  if ("is" in expr) return resolve(expr.is, ctx) === expr.value;
  if ("hasStatus" in expr) return tags(resolve(expr.hasStatus, ctx), "statuses").includes(expr.status);
  if ("hasFlag" in expr) return tags(resolve(expr.hasFlag, ctx), "flags").includes(expr.flag);
  if ("every" in expr)
    return collection(expr.every, ctx).every((item) => bool(expr.test, bind(ctx, expr.as, item)));
  if ("some" in expr)
    return collection(expr.some, ctx).some((item) => bool(expr.test, bind(ctx, expr.as, item)));
  if ("count" in expr) {
    const items = collection(expr.count, ctx);
    const { where, as } = expr;
    if (!where) return items.length;
    return items.filter((item) => bool(where, bind(ctx, as ?? "it", item))).length;
  }
  if ("query" in expr) {
    if (!ctx.geometry) throw new Error(`No geometry available for "${expr.query.kind}"`);
    return ctx.geometry(expr.query, ctx);
  }
  throw new Error(`Unknown expression: ${JSON.stringify(expr)}`);
}

export function num(expr: Expr, ctx: EvalContext): number {
  const v = evaluate(expr, ctx);
  if (typeof v !== "number") throw new Error(`Expected a number from ${JSON.stringify(expr)}`);
  return v;
}

export function bool(expr: Expr, ctx: EvalContext): boolean {
  const v = evaluate(expr, ctx);
  if (typeof v !== "boolean") throw new Error(`Expected true/false from ${JSON.stringify(expr)}`);
  return v;
}

/** Resolve a dotted path such as "weapon.S" or "param.x" against the scope. */
export function resolve(ref: string, ctx: EvalContext): unknown {
  let cur: unknown = ctx.scope;
  for (const part of ref.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Does an event match a pattern? Payload is visible to `where` as "event.*". */
export function matchesEvent(
  pattern: EventPattern,
  event: string,
  payload: object,
  ctx: EvalContext,
): boolean {
  if (pattern.event !== event) return false;
  return pattern.where === undefined || bool(pattern.where, bind(ctx, "event", payload));
}

export interface TestModifiers {
  modifier: number;
  targetModifier: number;
  reroll: "ones" | "failed" | "any" | null;
  criticalOn: number | null;
  reminders: string[];
}

/**
 * Fold every effect that fires on `event` into the modifiers for one dice
 * test, applying the step's modifier cap.
 */
export function collectTestModifiers(
  effects: Effect[],
  event: string,
  payload: object,
  ctx: EvalContext,
  modifierCap?: number,
): TestModifiers {
  const out: TestModifiers = {
    modifier: 0,
    targetModifier: 0,
    reroll: null,
    criticalOn: null,
    reminders: [],
  };
  const evCtx = bind(ctx, "event", payload);
  for (const effect of effects) {
    if (!matchesEvent(effect.when, event, payload, ctx)) continue;
    if (effect.if !== undefined && !bool(effect.if, evCtx)) continue;
    for (const action of effect.do) {
      switch (action.do) {
        case "modifyRoll":
          out.modifier += num(action.by, evCtx);
          break;
        case "modifyTarget":
          out.targetModifier += num(action.by, evCtx);
          break;
        case "reroll":
          if (typeof action.which === "string") out.reroll = strongerReroll(out.reroll, action.which);
          break;
        case "criticalOn": {
          const v = num(action.value, evCtx);
          out.criticalOn = out.criticalOn === null ? v : Math.min(out.criticalOn, v);
          break;
        }
        case "manual":
          out.reminders.push(action.reminder);
          break;
      }
    }
  }
  if (modifierCap !== undefined) out.modifier = Math.max(-modifierCap, Math.min(modifierCap, out.modifier));
  return out;
}

function headerIndex(headers: number[], value: number): number {
  let idx = 0;
  headers.forEach((h, i) => {
    if (h <= value) idx = i;
  });
  return idx;
}

function bind(ctx: EvalContext, name: string, value: unknown): EvalContext {
  return { ...ctx, scope: { ...ctx.scope, [name]: value } };
}

function toValue(v: unknown, ref: string): ExprValue {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v === null) return 0; // A "-" characteristic.
  throw new Error(`"${ref}" is not a number or true/false`);
}

function tags(v: unknown, key: "keywords" | "statuses" | "flags"): string[] {
  const list = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? (list as string[]) : [];
}

function collection(ref: string, ctx: EvalContext): unknown[] {
  const v = resolve(ref, ctx);
  if (!Array.isArray(v)) throw new Error(`"${ref}" is not a collection`);
  return v;
}

const REROLL_STRENGTH = { ones: 1, failed: 2, any: 3 } as const;

function strongerReroll(a: TestModifiers["reroll"], b: NonNullable<TestModifiers["reroll"]>) {
  return a && REROLL_STRENGTH[a] >= REROLL_STRENGTH[b] ? a : b;
}
