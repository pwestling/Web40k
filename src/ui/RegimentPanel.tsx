import { useState } from "react";
import {
  blockFrame,
  blockSlots,
  formBlock,
  forwardMove,
  systemOf,
  wheelMove,
  type BlockOrder,
  type Unit,
} from "../core";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { blockMoveUsed, blockSummary } from "./regiment";

const ORDERS: { id: BlockOrder | "skirmish"; label: string }[] = [
  { id: "close", label: "Close order" },
  { id: "column", label: "Column" },
  { id: "open", label: "Open order" },
  { id: "disrupted", label: "Disrupted" },
  { id: "skirmish", label: "Skirmish" },
];

const fmt = (n: number) => `${Number(n.toFixed(1))}"`;

/**
 * Manoeuvres for a regiment block (rank-and-flank games): move straight
 * ahead, wheel, turn, reform and march, each with the distance it uses and
 * advisory checks. Dragging the block on the table works too. Everything is
 * logged; nothing is blocked.
 */
export function RegimentPanel({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub, record, set } = useStore();
  const arcs = useStore((s) => s.arcs);
  const canControl = useCanControl();
  const mine = canControl(unit.owner) && scrub === null;
  const [ahead, setAhead] = useState(1);
  const [degrees, setDegrees] = useState(45);
  const frame = blockFrame(game, unit);
  const summary = blockSummary(game, unit);
  const [files, setFiles] = useState<number | null>(null);
  const ranked = systemOf(game).unitShape.kind === "ranked";
  const as = unit.owner;
  if (!frame || !summary || unit.formation.kind !== "ranked") {
    if (!ranked || unit.formation.kind === "ranked") return null;
    // A skirmishing unit in a rank-and-flank game can form a block again.
    const n = unit.modelIds.length;
    const f = files ?? Math.min(5, n);
    const facing = game.models[unit.modelIds[0] ?? ""]?.facing ?? 0;
    return (
      <div className="regiment">
        <h3>Skirmishing</h3>
        {mine && (
          <div className="row">
            <label>
              Frontage{" "}
              <input
                type="number"
                className="frontage"
                min={1}
                max={n}
                value={f}
                onChange={(e) => setFiles(Number(e.target.value) || 1)}
              />
            </label>
            <button
              onClick={() => {
                const blockUnit: Unit = { ...unit, formation: { kind: "ranked", files: f, order: "close" } };
                const centre = centreOf(game, unit);
                const { order, models } = formBlock(game, blockUnit, f, facing, centre);
                dispatch(
                  {
                    type: "unit/form",
                    id: unit.id,
                    formation: blockUnit.formation,
                    order,
                    models,
                    how: "reform",
                  },
                  as,
                );
              }}
            >
              Form a block
            </button>
          </div>
        )}
      </div>
    );
  }

  const order = unit.formation.order ?? "close";
  const used = blockMoveUsed(record, unit.id, scrub ?? Infinity);
  const marching = unit.status?.marching === true;
  const allowed = marching ? summary.march : summary.move;
  const over = allowed !== null && used > allowed + 0.05;
  const marchNear = marching && summary.nearestEnemy < summary.marchBlock;
  const frontage = files ?? summary.files;
  const alive = blockSlots(game, unit).length;
  const rearCount = alive - (summary.ranks - 1) * summary.files;
  const cost = (share: number) => (summary.move === null ? 0 : summary.move * share);

  const form = (newFiles: number, turn: number, how: "reform" | "turn", distance: number) => {
    const formation = { ...unit.formation, files: Math.max(1, Math.min(newFiles, alive)) };
    const laid = formBlock(game, { ...unit, formation }, formation.files, frame.facing + turn);
    dispatch({ type: "unit/form", id: unit.id, formation, ...laid, how, distance }, as);
  };
  const setOrder = (id: BlockOrder | "skirmish") =>
    dispatch(
      {
        type: "unit/form",
        id: unit.id,
        formation: id === "skirmish" ? { kind: "skirmish" } : { ...unit.formation, order: id },
        how: "order",
      },
      as,
    );
  const wheelCost = frame.width * ((degrees * Math.PI) / 180);

  return (
    <div className="regiment">
      <h3>Regiment</h3>
      <p className="muted">
        {summary.files} wide · {summary.ranks} rank{summary.ranks === 1 ? "" : "s"} · unit strength{" "}
        {summary.strength}
        {order === "close" ? ` · rank bonus +${summary.rankBonus}` : ""}
      </p>
      <p className="muted small">
        Front to rear: {alive} models; the rear rank has {rearCount} of {summary.files}. Casualties come off
        the rear rank.
      </p>
      <div className="row">
        <select
          aria-label="Formation"
          value={order}
          disabled={!mine}
          onChange={(e) => setOrder(e.target.value as BlockOrder | "skirmish")}
        >
          {ORDERS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          className={arcs ? "on" : ""}
          onClick={() => set({ arcs: !arcs })}
          title="Show front, flank and rear arcs"
        >
          Arcs
        </button>
      </div>
      {game.turn.round > 0 && (
        <p className={over || marchNear ? "warn" : "muted"}>
          Moved {fmt(used)}
          {allowed !== null ? ` of ${fmt(allowed)}${marching ? " (marching)" : ""}` : ""}
          {over ? " · over its move" : ""}
          {marchNear ? ` · an enemy is within ${summary.marchBlock}": marching needs a Leadership test` : ""}
        </p>
      )}
      {mine && (
        <>
          <div className="row">
            <input
              type="number"
              aria-label="Inches to move"
              className="frontage"
              min={0}
              step={0.5}
              value={ahead}
              onChange={(e) => setAhead(Number(e.target.value) || 0)}
            />
            <button onClick={() => dispatch(forwardMove(frame, unit.id, ahead), as)}>Forward</button>
            <button onClick={() => dispatch(forwardMove(frame, unit.id, -ahead), as)}>Back</button>
            <label title="A march is double Movement, straight ahead">
              <input
                type="checkbox"
                checked={marching}
                onChange={(e) =>
                  dispatch(
                    { type: "unit/status", id: unit.id, key: "marching", value: e.target.checked || null },
                    as,
                  )
                }
              />{" "}
              March
            </label>
          </div>
          <div className="row">
            <input
              type="number"
              aria-label="Degrees to wheel"
              className="frontage"
              min={1}
              max={180}
              step={5}
              value={degrees}
              onChange={(e) => setDegrees(Number(e.target.value) || 0)}
            />
            °
            <button onClick={() => dispatch(wheelMove(frame, unit.id, (-degrees * Math.PI) / 180), as)}>
              Wheel left
            </button>
            <button onClick={() => dispatch(wheelMove(frame, unit.id, (degrees * Math.PI) / 180), as)}>
              Wheel right
            </button>
            <span className="muted small">{fmt(wheelCost)}</span>
          </div>
          <div className="row">
            <button
              title={`Costs ${fmt(cost(summary.turnCost))}`}
              onClick={() => form(summary.ranks, Math.PI / 2, "turn", cost(summary.turnCost))}
            >
              Turn left
            </button>
            <button
              title={`Costs ${fmt(cost(summary.turnCost))}`}
              onClick={() => form(summary.ranks, -Math.PI / 2, "turn", cost(summary.turnCost))}
            >
              Turn right
            </button>
            <button
              title={`Costs ${fmt(cost(summary.turnCost))}`}
              onClick={() => form(summary.files, Math.PI, "turn", cost(summary.turnCost))}
            >
              About face
            </button>
          </div>
          <div className="row">
            <label>
              Frontage{" "}
              <input
                type="number"
                className="frontage"
                min={1}
                max={alive}
                value={frontage}
                onChange={(e) => setFiles(Number(e.target.value) || 1)}
              />
            </label>
            <button
              title={`Rebuild the block around its centre; costs ${fmt(cost(summary.reformCost))}`}
              onClick={() => {
                form(frontage, 0, "reform", game.turn.round > 0 ? cost(summary.reformCost) : 0);
                setFiles(null);
              }}
            >
              Reform
            </button>
          </div>
          {marching && used > 0.05 && (
            <p className="muted small">Marching blocks may only move straight ahead and wheel.</p>
          )}
        </>
      )}
    </div>
  );
}

function centreOf(game: ReturnType<typeof useGame>, unit: Unit) {
  const ms = unit.modelIds.flatMap((id) => {
    const m = game.models[id];
    return m && !m.destroyed ? [m] : [];
  });
  const n = Math.max(1, ms.length);
  return { x: ms.reduce((a, m) => a + m.position.x, 0) / n, y: ms.reduce((a, m) => a + m.position.y, 0) / n };
}
