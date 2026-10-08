import type { GameState, Unit } from "../core";
import { systemOf } from "../core";
import { evaluate } from "../core/content/expr";
import { evalCtx, safeBool } from "../core/content/play";
import { unitView } from "../core/content/runtime";
import type { CheckDef } from "../core/content/schema";
import { gameView } from "../core/script";
import { t } from "../i18n";
import { gameModule } from "../systems";
import { aliveModels, unitMoved } from "../systems/wh40k/rules";

/**
 * The Table warnings panel's checks (roadmap #26): every data check in the
 * game system (coherency, move distance, …) and every warning its module's
 * code returns, run against the table as it stands. Advisory: a warning can
 * be dismissed on this screen, or overridden for everyone, which lasts until
 * the unit moves again.
 */

export interface TableWarning {
  /** Unique on the table: check, unit and where its models stand. */
  key: string;
  checkId: string;
  unitId?: string;
  message: string;
  severity: "info" | "warning";
}

/** Names for the code checks' ids, where no data check names them. */
const NAMES: Record<string, () => string> = {
  coherency: () => t("Unit coherency"),
  moveDistance: () => t("Move distance"),
  terrain: () => t("Moving through terrain"),
  deepStrike: () => "Deep Strike",
  activateFirst: () => t("Activate before moving"),
  areaOfControl: () => t("Area of control"),
  deployDistance: () => t("Deploying from reserve"),
};

export function checkName(state: GameState, id: string): string {
  return systemOf(state).checks?.find((c) => c.id === id)?.name ?? NAMES[id]?.() ?? id;
}

/** Where a unit's models stand, as one number: an override lasts while it doesn't change. */
export function placement(state: GameState, unit: Unit): number {
  let h = 7;
  for (const m of aliveModels(state, unit))
    h =
      (h * 31 +
        Math.round(m.position.x * 20) * 7 +
        Math.round(m.position.y * 20) * 13 +
        Math.round((m.z ?? 0) * 20)) %
      1_000_000_007;
  return h;
}

/** The status key that records an override of one check on one unit. */
export const overrideKey = (checkId: string) => `ok.${checkId}`;

const usesEvent = (check: CheckDef) => JSON.stringify([check.if, check.require]).includes('"event.');

function dataWarnings(state: GameState, unit: Unit, checks: CheckDef[]): Omit<TableWarning, "key">[] {
  const system = systemOf(state);
  const alive = aliveModels(state, unit);
  // A move check needs a move to look at: how far the unit went this phase, and how far it may.
  const allowed = typeof unit.status?.allowance === "number" ? unit.status.allowance : null;
  const moved = unitMoved(alive);
  const out: Omit<TableWarning, "key">[] = [];
  for (const check of checks) {
    const moving = usesEvent(check);
    if (moving && (allowed === null || moved < 0.05 || state.turn.round === 0)) continue;
    const ctx = evalCtx(state, system, {
      self: unitView(state, system, unit),
      event: { inchesMoved: moved, allowed, unitId: unit.id },
    });
    if (check.if && !safeBool(check.if, ctx)) continue;
    let ok: boolean;
    try {
      ok = !!evaluate(check.require, ctx);
    } catch {
      // A check that can't be worked out here says nothing, rather than a false alarm.
      continue;
    }
    if (!ok)
      out.push({
        checkId: check.id,
        unitId: unit.id,
        message: check.message,
        severity: check.severity ?? "warning",
      });
  }
  return out;
}

/** Every warning on the table now, overridden ones left out. */
/** Code checks that measure the table. */
const MEASURED = new Set(["coherency", "moveDistance", "terrain", "deepStrike"]);

export function tableWarnings(state: GameState): TableWarning[] {
  const system = systemOf(state);
  const module = gameModule(state.system);
  const found: Omit<TableWarning, "key">[] = [];
  const codeIds = new Set<string>();
  if (module?.checks) {
    try {
      for (const w of module.checks(gameView(state, module.id))) {
        const checkId = w.id ?? "module";
        codeIds.add(checkId);
        found.push({ checkId, unitId: w.unitId, message: w.message, severity: w.severity ?? "warning" });
      }
    } catch (e) {
      console.warn("A table check failed", e);
    }
  }
  // A code check replaces the data check of the same id, whether or not it found anything.
  const ids = new Set([...(module?.replacesChecks ?? []), ...codeIds]);
  const data = (system.checks ?? []).filter((c) => !ids.has(c.id));
  if (data.length)
    for (const unit of Object.values(state.units)) {
      if (unit.status?.reserves || !aliveModels(state, unit).length) continue;
      found.push(...dataWarnings(state, unit, data));
    }
  // At a real table (#37) positions here mean nothing: checks that measure the board stay quiet.
  const measured = (w: { checkId: string }) =>
    MEASURED.has(w.checkId) ||
    (system.checks ?? []).some((c) => c.id === w.checkId && JSON.stringify(c).includes('"query"'));
  return found.flatMap((w) => {
    if (state.settings.companion && measured(w)) return [];
    const unit = w.unitId ? state.units[w.unitId] : undefined;
    const where = unit ? placement(state, unit) : 0;
    if (unit && unit.status?.[overrideKey(w.checkId)] === where) return [];
    return [{ ...w, key: `${w.checkId}:${w.unitId ?? ""}:${where}` }];
  });
}
