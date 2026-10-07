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
import { ChargePanel } from "./ChargePanel";
import { useGame } from "./hooks";
import { blockMoveUsed, blockSummary, moveBudget, offTable, type MoveBudget } from "./regiment";

const ORDERS: { id: Exclude<BlockOrder, "disrupted"> | "skirmish"; label: string }[] = [
  { id: "close", label: "Close order" },
  { id: "column", label: "Column" },
  { id: "open", label: "Open order" },
  { id: "skirmish", label: "Skirmish" },
];

const FACINGS: { label: string; turn: number }[] = [
  { label: "same way", turn: 0 },
  { label: "left", turn: Math.PI / 2 },
  { label: "right", turn: -Math.PI / 2 },
  { label: "about", turn: Math.PI },
];

const fmt = (n: number) => `${Number(n.toFixed(1))}"`;

/**
 * Manoeuvres for a regiment block (rank-and-flank games): move straight
 * ahead, wheel, turn, redress, reform and march, each with the distance it
 * uses and advisory checks. Dragging the block on the table works too.
 * Everything is logged; nothing is blocked.
 */
export function RegimentPanel({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub, record, set } = useStore();
  const arcs = useStore((s) => s.arcs);
  const canControl = useCanControl();
  const mine = canControl(unit.owner) && scrub === null;
  const [ahead, setAhead] = useState(1);
  const [degrees, setDegrees] = useState(45);
  const [files, setFiles] = useState<number | null>(null);
  const [facing, setFacing] = useState(0);
  const frame = blockFrame(game, unit);
  const summary = blockSummary(game, unit);
  const ranked = systemOf(game).unitShape.kind === "ranked";
  const as = unit.owner;
  const used = blockMoveUsed(record, unit.id, scrub ?? Infinity);
  const marching = unit.status?.marching === true;
  // Activation games (Conquest): moves come from actions (March gives its distance), and the
  // charge panel opens once the Charge action is taken.
  const sys = systemOf(game);
  const activations = sys.actions.some((a) => a.activates !== undefined);
  const chargeAction = sys.actions.some((a) => a.id === "charge");
  const showCharge = !chargeAction || unit.status?.charged === true;
  const allowance = typeof unit.status?.allowance === "number" ? unit.status.allowance : 0;
  const toGo = activations ? Math.max(0, allowance - used) : 0;
  const status = (key: string, value: number | boolean | null) =>
    dispatch({ type: "unit/status", id: unit.id, key, value }, as);

  if (!frame || !summary || unit.formation.kind !== "ranked") {
    if (!ranked || unit.formation.kind === "ranked") return null;
    // A skirmishing unit in a rank-and-flank game: its move, and forming a block again.
    const n = unit.modelIds.length;
    const last = typeof unit.status?.lastFiles === "number" ? unit.status.lastFiles : Math.min(5, n);
    const f = files ?? last;
    const turnFacing = game.models[unit.modelIds[0] ?? ""]?.facing ?? 0;
    return (
      <div className="regiment">
        <h3>Skirmishing</h3>
        <MovedLine
          budget={moveBudget(game, unit)}
          used={used}
          marching={false}
          off={offTable(game, unit)}
          round={game.turn.round}
        />
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
                const { order, models } = formBlock(game, blockUnit, f, turnFacing, centreOf(game, unit));
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
                setFiles(null);
              }}
            >
              Form a block
            </button>
          </div>
        )}
        {showCharge && <ChargePanel unit={unit} />}
      </div>
    );
  }

  const order = unit.formation.order === "disrupted" ? "close" : (unit.formation.order ?? "close");
  const frontage = files ?? summary.files;
  const alive = blockSlots(game, unit).length;
  const rearCount = alive - (summary.ranks - 1) * summary.files;
  const cost = (share: number) => (summary.move === null ? 0 : summary.move * share);
  const fighting = game.turn.round > 0;
  const redress =
    facing === 0 && frontage !== summary.files && Math.abs(frontage - summary.files) <= summary.redressMax;

  const form = (newFiles: number, turn: number, how: "reform" | "redress" | "turn", distance: number) => {
    const formation = { ...unit.formation, files: Math.max(1, Math.min(newFiles, alive)) };
    const laid = formBlock(game, { ...unit, formation }, formation.files, frame.facing + turn);
    dispatch(
      { type: "unit/form", id: unit.id, formation, ...laid, how, distance: fighting ? distance : 0 },
      as,
    );
  };
  const block = unit.formation;
  const setOrder = (id: (typeof ORDERS)[number]["id"]) => {
    if (id === "skirmish") {
      // Remember the frontage for when it forms up again; skirmishers don't march.
      status("lastFiles", block.files);
      if (marching) status("marching", null);
      dispatch({ type: "unit/form", id: unit.id, formation: { kind: "skirmish" }, how: "order" }, as);
    } else dispatch({ type: "unit/form", id: unit.id, formation: { ...block, order: id }, how: "order" }, as);
  };
  const wheelCost = frame.width * ((degrees * Math.PI) / 180);
  // A character, chariot or monster on its own: no ranks, frontage or formation to manage.
  const lone = unit.modelIds.length === 1;

  return (
    <div className="regiment">
      <h3>{lone ? "Single model" : "Regiment"}</h3>
      {lone ? (
        summary.rankBonuses && <p className="muted">Unit strength {summary.strength}</p>
      ) : !summary.rankBonuses ? (
        <p className="muted small">
          {summary.files} wide · {summary.ranks} rank{summary.ranks === 1 ? "" : "s"}. Casualties come off the
          rear rank.
        </p>
      ) : (
        <>
          <p className="muted">
            {summary.files} wide · {summary.ranks} rank{summary.ranks === 1 ? "" : "s"} · unit strength{" "}
            {summary.strength}
            {order === "close" ? ` · rank bonus +${summary.rankBonus}` : ""}
            {summary.disrupted ? " (disrupted)" : ""}
          </p>
          <p className="muted small">
            Ranks count from {summary.rankWidth} wide. Front to rear: {alive} models; the rear rank has{" "}
            {rearCount} of {summary.files}. Casualties come off the rear rank.
          </p>
        </>
      )}
      <div className="row">
        {!lone && summary.rankBonuses && (
          <select
            aria-label="Formation"
            value={order}
            disabled={!mine}
            onChange={(e) => setOrder(e.target.value as (typeof ORDERS)[number]["id"])}
          >
            {ORDERS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {!lone && summary.rankBonuses && (
          <button
            className={summary.disrupted ? "on" : ""}
            disabled={!mine}
            title="Disrupted units lose their rank bonus"
            onClick={() => status("disrupted", summary.disrupted ? null : true)}
          >
            Disrupted
          </button>
        )}
        <button
          className={arcs ? "on" : ""}
          onClick={() => set({ arcs: !arcs })}
          title="Show front, flank and rear arcs"
        >
          Arcs
        </button>
      </div>
      {!activations && (
        <MovedLine
          budget={summary}
          used={used}
          marching={marching}
          off={offTable(game, unit)}
          round={game.turn.round}
        />
      )}
      {mine && toGo > 0.05 && (
        <div className="row">
          <span>Move up to {fmt(toGo)} now:</span>
          <button className="primary" onClick={() => dispatch(forwardMove(frame, unit.id, toGo), as)}>
            Forward {fmt(toGo)}
          </button>
          <span className="muted small">or drag, wheel or turn</span>
        </div>
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
            {!activations && (
              <label title="A march is double Movement, straight ahead">
                <input
                  type="checkbox"
                  checked={marching}
                  onChange={(e) => status("marching", e.target.checked || null)}
                />{" "}
                March
              </label>
            )}
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
              title={`Costs ${fmt(cost(summary.turnCost * 2))}`}
              onClick={() => form(summary.files, Math.PI, "turn", cost(summary.turnCost * 2))}
            >
              About face
            </button>
          </div>
          {!lone && (
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
              <label>
                facing{" "}
                <select
                  aria-label="Facing after reforming"
                  value={facing}
                  onChange={(e) => setFacing(Number(e.target.value))}
                >
                  {FACINGS.map((f, i) => (
                    <option key={f.label} value={i}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {redress && (
                <button
                  title={`Add or remove up to ${summary.redressMax} models from the front rank; costs ${fmt(cost(summary.redressCost))}`}
                  onClick={() => {
                    form(frontage, 0, "redress", cost(summary.redressCost));
                    setFiles(null);
                  }}
                >
                  Redress
                </button>
              )}
              <button
                title={`Rebuild the block around its centre; costs all its move (${fmt(cost(summary.reformCost))})`}
                onClick={() => {
                  form(frontage, FACINGS[facing]!.turn, "reform", cost(summary.reformCost));
                  setFiles(null);
                  setFacing(0);
                }}
              >
                Reform
              </button>
            </div>
          )}
          {marching && used > 0.05 && (
            <p className="muted small">Marching blocks may only move straight ahead and wheel.</p>
          )}
        </>
      )}
      {showCharge && <ChargePanel unit={unit} />}
    </div>
  );
}

/** The move used this phase against what the unit may move, with advisory notes. */
function MovedLine({
  budget,
  used,
  marching,
  off,
  round,
}: {
  budget: MoveBudget;
  used: number;
  marching: boolean;
  off: boolean;
  round: number;
}) {
  if (round <= 0) return off ? <p className="warn">Off the table</p> : null;
  const allowed = marching ? budget.march : budget.move;
  const over = allowed !== null && used > allowed + 0.05;
  const marchNear = marching && budget.nearestEnemy < budget.marchBlock;
  return (
    <p className={over || marchNear || off ? "warn" : "muted"}>
      Moved {fmt(used)}
      {allowed !== null ? ` of ${fmt(allowed)}${marching ? " (marching)" : ""}` : ""}
      {over ? " · over its move" : ""}
      {off ? " · off the table" : ""}
      {marchNear
        ? ` · an enemy is within ${budget.marchBlock}": marching needs a Leadership test (if failed, it moves normally but counts as having marched)`
        : ""}
    </p>
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
