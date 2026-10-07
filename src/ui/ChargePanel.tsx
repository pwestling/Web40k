import { useMemo, useState } from "react";
import {
  awayFrom,
  closeDoor,
  fleeMove,
  parseDice,
  pursue,
  towardsNearestEdge,
  undoneSeqs,
  unitCentre,
  unitGap,
  type GameRecord,
  type Unit,
} from "../core";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { useGame } from "./hooks";
import { moveBudget } from "./regiment";

const fmt = (n: number) => `${Number(n.toFixed(1))}"`;
const ARC_EDGE = { front: "front", rear: "rear", left: "left flank", right: "right flank" } as const;
/** Touching, for closing the door: bases this close count as in contact. */
const CONTACT = 0.1;

type RollKind = "charge roll" | "flee roll" | "pursuit roll";

/**
 * Charges, flight and pursuit by hand, for rank-and-flank systems. Charge
 * into an enemy (checked against the charge roll), close the door once in
 * contact, flee from an enemy (or towards the nearest edge) by a rolled
 * distance, and pursue a fleeing unit, seeing beforehand whether the roll
 * catches it.
 */
export function ChargePanel({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub, record } = useStore();
  const canControl = useCanControl();
  const mine = canControl(unit.owner) && scrub === null;
  const mod = systemModule(game.system);
  const move = moveBudget(game, unit).move ?? 0;
  const chargeDice = mod.chargeRoll ?? { count: 2, sides: 6, keep: "highest" as const };
  const fleeDice = mod.fleeDice ?? "2D6";
  // Within reach: what a charge (or a long flight or pursuit) could cover.
  const reach = Math.max(move + chargeDice.sides * (chargeDice.keep === "sum" ? chargeDice.count : 1), 12);
  // Base to base, as Declare charge measures it.
  const enemies = useMemo(
    () =>
      Object.values(game.units)
        .filter((u) => u.owner !== unit.owner && u.modelIds.some((id) => !game.models[id]?.destroyed))
        .map((u) => ({ unit: u, d: unitGap(game, unit, u) }))
        .sort((a, b) => a.d - b.d),
    [game, unit],
  );
  const [pick, setPick] = useState<string | null>(null);
  // The charge declared for this unit this round picks the enemy until the player picks another.
  const declared = game.modules?.[game.system ?? ""]?.[`charge:${unit.id}`] as
    { target?: string; round?: number } | undefined;
  const declaredTarget = declared?.round === game.turn.round ? declared.target : undefined;
  const [typed, setTyped] = useState<number | null>(null);
  const upto = scrub ?? Infinity;
  const flee = lastRoll(record, unit.id, upto, "flee roll");
  const pursuit = lastRoll(record, unit.id, upto, "pursuit roll");
  const charge = lastRoll(record, unit.id, upto, "charge roll");
  const charged = chargedThisPhase(record, unit.id, upto);
  if (!mine || !enemies.length) return null;
  const enemy = enemies.find((e) => e.unit.id === (pick ?? declaredTarget))?.unit ?? enemies[0]!.unit;
  const near = enemies.filter((e) => e.d <= reach);
  const far = enemies.filter((e) => e.d > reach);
  const door = closeDoor(game, unit, enemy);
  const touching = unitGap(game, unit, enemy) <= CONTACT;
  const flush = !door || door.distance < 0.05;
  const inches = typed ?? flee?.total ?? pursuit?.total ?? 0;
  const chase = inches > 0 ? pursue(game, unit, enemy, inches) : null;
  const fleeing = unit.status?.fleeing === true;
  const as = unit.owner;
  const chargeDie = charge ? (chargeDice.keep === "highest" ? charge.keep : charge.total) : 0;
  const chargeRange = charge ? chargeDie + move : null;
  const short = !!door && chargeRange !== null && door.distance > chargeRange + 0.05;
  const roll = (label: RollKind) => {
    setTyped(null);
    if (label === "charge roll") {
      dispatch(
        { type: "dice/roll", count: chargeDice.count, sides: chargeDice.sides, label, unitId: unit.id },
        as,
      );
      return;
    }
    let expr;
    try {
      expr = parseDice(fleeDice);
    } catch {
      return;
    }
    dispatch({ type: "dice/roll", count: expr.count, sides: expr.sides, label, unitId: unit.id }, as);
  };
  const runAway = (away: { x: number; y: number }) => {
    const m = fleeMove(game, unit, away, inches);
    if (!m) return;
    dispatch(m, as);
    if (!fleeing) dispatch({ type: "unit/status", id: unit.id, key: "fleeing", value: true }, as);
    setTyped(null);
  };

  return (
    <div className="charge">
      <h4>{mod.fleeDice ? "Charge, flee, pursue" : "Charge"}</h4>
      <div className="row">
        <select aria-label="Enemy unit" value={enemy.id} onChange={(e) => setPick(e.target.value)}>
          {near.map((e) => (
            <option key={e.unit.id} value={e.unit.id}>
              {e.unit.name} ({fmt(e.d)})
            </option>
          ))}
          {far.length > 0 && (
            <optgroup label="Further away">
              {far.map((e) => (
                <option key={e.unit.id} value={e.unit.id}>
                  {e.unit.name} ({fmt(e.d)})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {door && !touching && (
        <div className="row">
          <button onClick={() => roll("charge roll")}>Roll to charge</button>
          <button
            title={
              short
                ? `The roll falls ${fmt(door.distance - chargeRange!)} short of ${enemy.name}`
                : `Move into contact with ${enemy.name}'s ${ARC_EDGE[door.arc]}, lined up flush`
            }
            className={short ? "" : "primary"}
            disabled={short}
            onClick={() => dispatch({ ...door.move, how: "charge" }, as)}
          >
            Charge into its {ARC_EDGE[door.arc]} ({fmt(door.distance)})
          </button>
          {chargeRange !== null && (
            <span className={short ? "warn" : "muted small"}>
              range {fmt(chargeRange)} ({chargeDie} + M {move}){short ? " · too short" : " · reaches ✓"}
            </span>
          )}
        </div>
      )}
      {door && touching && !flush && (
        <div className="row">
          <button
            title={`Line up flush with ${enemy.name}'s ${ARC_EDGE[door.arc]}`}
            onClick={() => dispatch(door.move, as)}
          >
            Close the door ({fmt(door.distance)})
          </button>
        </div>
      )}
      {charged > 0 && <p className="muted small">Charged {fmt(charged)} this phase.</p>}
      {mod.fleeDice && (
        <>
          <div className="row">
            <input
              type="number"
              aria-label="Inches to flee or pursue"
              className="frontage"
              min={0}
              step={1}
              value={inches}
              onChange={(e) => setTyped(Number(e.target.value) || 0)}
            />
            <button onClick={() => roll("flee roll")}>Roll to flee</button>
            <button
              disabled={!inches}
              title={`Turn and run directly away from ${enemy.name}`}
              onClick={() => runAway(awayFrom(game, unit, unitCentre(game, enemy)))}
            >
              Flee
            </button>
            <button
              disabled={!inches}
              title="A fleeing unit runs towards the nearest table edge"
              onClick={() => runAway(towardsNearestEdge(game, unit))}
            >
              Flee to edge
            </button>
          </div>
          <div className="row">
            <button onClick={() => roll("pursuit roll")}>Roll to pursue</button>
            <button disabled={!chase} onClick={() => chase && dispatch(chase.move, as)}>
              Pursue {enemy.name}
            </button>
            {chase && (
              <span className={chase.caught ? "warn" : "muted small"}>
                {chase.caught
                  ? `catches it after ${fmt(chase.moved)}`
                  : Number.isFinite(chase.gap)
                    ? `falls ${fmt(chase.gap)} short`
                    : "won't reach it"}
              </span>
            )}
          </div>
        </>
      )}
      {fleeing && (
        <div className="row">
          <span className="warn">Fleeing</span>
          <button
            onClick={() => dispatch({ type: "unit/status", id: unit.id, key: "fleeing", value: null }, as)}
          >
            Rallied
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The unit's latest roll of this kind, if nothing has used it yet (its
 * newest roll is this one, and no flee, pursuit or charge move came after).
 */
function lastRoll(
  record: GameRecord,
  unitId: string,
  upto: number,
  label: RollKind,
): { total: number; keep: number } | null {
  for (let i = record.events.length - 1; i >= 0; i--) {
    const { seq, event } = record.events[i]!;
    if (seq > upto) continue;
    if (event.type === "dice/roll" && event.roll.unitId === unitId) {
      if (event.roll.label !== label) return null;
      const rs = event.roll.results;
      return { total: rs.reduce((a, b) => a + b, 0), keep: Math.max(...rs) };
    }
    if (
      event.type === "unit/move" &&
      event.id === unitId &&
      (event.how === "flee" || event.how === "pursue" || event.how === "charge")
    )
      return null;
  }
  return null;
}

/** Inches charged this phase (charge and door moves since the phase began). */
function chargedThisPhase(record: GameRecord, unitId: string, upto: number): number {
  const undone = undoneSeqs(record, upto);
  let total = 0;
  for (const { seq, event } of record.events) {
    if (seq > upto) break;
    if (undone.has(seq)) continue;
    if (event.type.startsWith("turn/")) total = 0;
    else if (
      event.type === "unit/move" &&
      event.id === unitId &&
      (event.how === "charge" || event.how === "door")
    )
      total += event.distance ?? 0;
  }
  return total;
}
