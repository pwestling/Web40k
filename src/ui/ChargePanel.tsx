import { useMemo, useState } from "react";
import {
  awayFrom,
  closeDoor,
  fleeMove,
  parseDice,
  pursue,
  towardsNearestEdge,
  unitCentre,
  type GameRecord,
  type Unit,
} from "../core";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { useGame } from "./hooks";

const fmt = (n: number) => `${Number(n.toFixed(1))}"`;
const ARC_EDGE = { front: "front", rear: "rear", left: "left flank", right: "right flank" } as const;

/**
 * Charges, flight and pursuit by hand, for rank-and-flank systems: close the
 * door on an enemy (line up flush with the edge charged), flee from one (or
 * towards the nearest edge) by a rolled distance, and pursue a fleeing unit,
 * seeing beforehand whether the roll catches it.
 */
export function ChargePanel({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub, record } = useStore();
  const canControl = useCanControl();
  const mine = canControl(unit.owner) && scrub === null;
  const centre = unitCentre(game, unit);
  const enemies = useMemo(
    () =>
      Object.values(game.units)
        .filter((u) => u.owner !== unit.owner && u.modelIds.some((id) => !game.models[id]?.destroyed))
        .map((u) => {
          const c = unitCentre(game, u);
          return { unit: u, d: Math.hypot(c.x - centre.x, c.y - centre.y) };
        })
        .sort((a, b) => a.d - b.d),
    [game, unit.owner, centre.x, centre.y],
  );
  const [pick, setPick] = useState<string | null>(null);
  const [typed, setTyped] = useState<number | null>(null);
  const dice = systemModule(game.system).fleeDice ?? "2D6";
  const rolled = lastRoll(record, unit.id, scrub ?? Infinity);
  const inches = typed ?? rolled ?? 0;
  if (!mine || !enemies.length) return null;
  const enemy = enemies.find((e) => e.unit.id === pick)?.unit ?? enemies[0]!.unit;
  const door = closeDoor(game, unit, enemy);
  const chase = inches > 0 ? pursue(game, unit, enemy, inches) : null;
  const fleeing = unit.status?.fleeing === true;
  const as = unit.owner;
  const flee = (away: { x: number; y: number }) => {
    const move = fleeMove(game, unit, away, inches);
    if (!move) return;
    dispatch(move, as);
    if (!fleeing) dispatch({ type: "unit/status", id: unit.id, key: "fleeing", value: true }, as);
    setTyped(null);
  };
  let expr: { count: number; sides: number } | null = null;
  try {
    expr = parseDice(dice);
  } catch {
    expr = null;
  }

  return (
    <div className="charge">
      <h4>Charge, flee, pursue</h4>
      <div className="row">
        <select aria-label="Enemy unit" value={enemy.id} onChange={(e) => setPick(e.target.value)}>
          {enemies.map((e) => (
            <option key={e.unit.id} value={e.unit.id}>
              {e.unit.name} ({fmt(e.d)})
            </option>
          ))}
        </select>
        {door && (
          <button
            title={`Line up flush with ${enemy.name}'s ${ARC_EDGE[door.arc]}; moves up to ${fmt(door.distance)}`}
            onClick={() => dispatch(door.move, as)}
          >
            Close the door ({fmt(door.distance)})
          </button>
        )}
      </div>
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
        {expr && (
          <button
            onClick={() => {
              setTyped(null);
              dispatch(
                {
                  type: "dice/roll",
                  count: expr.count,
                  sides: expr.sides,
                  label: "flee or pursuit",
                  unitId: unit.id,
                },
                as,
              );
            }}
          >
            Roll {dice}
          </button>
        )}
        <button
          disabled={!inches}
          title={`Turn and run directly away from ${enemy.name}`}
          onClick={() => flee(awayFrom(game, unit, unitCentre(game, enemy)))}
        >
          Flee
        </button>
        <button
          disabled={!inches}
          title="A fleeing unit runs towards the nearest table edge"
          onClick={() => flee(towardsNearestEdge(game, unit))}
        >
          Flee to edge
        </button>
      </div>
      <div className="row">
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

/** The total of the unit's latest flee or pursuit roll, if its newest roll is one. */
function lastRoll(record: GameRecord, unitId: string, upto: number): number | null {
  for (let i = record.events.length - 1; i >= 0; i--) {
    const { seq, event } = record.events[i]!;
    if (seq > upto) continue;
    if (event.type === "dice/roll" && event.roll.unitId === unitId)
      return event.roll.label === "flee or pursuit" ? event.roll.results.reduce((a, b) => a + b, 0) : null;
    if (event.type === "unit/move" && event.id === unitId && (event.how === "flee" || event.how === "pursue"))
      return null;
  }
  return null;
}
