import { useState } from "react";
import {
  blockFrame,
  blockSlots,
  formBlock,
  forwardMove,
  sidewaysMove,
  systemOf,
  wheelMove,
  type BlockOrder,
  type Unit,
} from "../core";
import { useCanControl, useStore } from "../store";
import { ChargePanel } from "./ChargePanel";
import { useGame } from "./hooks";
import { t, tn } from "../i18n";
import { blockMoves, blockSummary, moveBudget, offTable, type Manoeuvre, type MoveBudget } from "./regiment";

type OrderId = Exclude<BlockOrder, "disrupted"> | "skirmish";

const orders = (): { id: OrderId; label: string }[] => [
  { id: "close", label: t("Close order") },
  { id: "column", label: t("Column") },
  { id: "open", label: t("Open order") },
  { id: "skirmish", label: t("Skirmish") },
];

const facings = (): { label: string; turn: number }[] => [
  { label: t("same way"), turn: 0 },
  { label: t("left"), turn: Math.PI / 2 },
  { label: t("right"), turn: -Math.PI / 2 },
  { label: t("about"), turn: Math.PI },
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
  const { used, manoeuvres } = blockMoves(
    record,
    unit.id,
    scrub ?? Infinity,
    systemOf(game).constants?.slowMoveCost ?? 1,
  );
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
        <h3>{t("Skirmishing")}</h3>
        <MovedLine
          budget={moveBudget(game, unit)}
          used={used}
          manoeuvres={manoeuvres}
          marching={false}
          off={offTable(game, unit)}
          round={game.turn.round}
        />
        {mine && (
          <div className="row">
            <label>
              {t("Frontage")}{" "}
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
              {t("Form a block")}
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
  // Drilled: a free redress before the block has moved.
  const freeRedress = summary.drilled && used < 0.05 && manoeuvres.length === 0;
  const redressDistance = freeRedress ? 0 : cost(summary.redressCost);
  const slowTitle =
    summary.slow > 1 ? t("Half rate: costs {distance}", { distance: fmt(ahead * summary.slow) }) : undefined;
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
  const setOrder = (id: OrderId) => {
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
      <h3>{lone ? t("Single model") : t("Regiment")}</h3>
      {lone ? (
        summary.rankBonuses && (
          <p className="muted">{t("Unit strength {strength}", { strength: summary.strength })}</p>
        )
      ) : !summary.rankBonuses ? (
        <p className="muted small">
          {tn(
            summary.ranks,
            "{files} wide · {n} rank. Casualties come off the rear rank.",
            "{files} wide · {n} ranks. Casualties come off the rear rank.",
            { files: summary.files },
          )}
        </p>
      ) : (
        <>
          <p className="muted">
            {tn(
              summary.ranks,
              "{files} wide · {n} rank · unit strength {strength}",
              "{files} wide · {n} ranks · unit strength {strength}",
              { files: summary.files, strength: summary.strength },
            )}
            {order === "close" ? <> · {t("rank bonus +{bonus}", { bonus: summary.rankBonus })}</> : ""}
            {summary.disrupted ? <> ({t("disrupted")})</> : ""}
          </p>
          <p className="muted small">
            {t(
              "Ranks count from {width} wide. Front to rear: {alive} models; the rear rank has {rear} of {files}. Casualties come off the rear rank.",
              { width: summary.rankWidth, alive, rear: rearCount, files: summary.files },
            )}
          </p>
        </>
      )}
      <div className="row">
        {!lone && summary.rankBonuses && (
          <select
            aria-label={t("Formation")}
            value={order}
            disabled={!mine}
            onChange={(e) => setOrder(e.target.value as OrderId)}
          >
            {orders().map((o) => (
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
            title={t("Disrupted units lose their rank bonus")}
            onClick={() => status("disrupted", summary.disrupted ? null : true)}
          >
            {t("Disrupted")}
          </button>
        )}
        <button
          className={arcs ? "on" : ""}
          onClick={() => set({ arcs: !arcs })}
          title={t("Show front, flank and rear arcs")}
        >
          {t("Arcs")}
        </button>
      </div>
      {!activations && (
        <MovedLine
          budget={summary}
          used={used}
          manoeuvres={manoeuvres}
          marching={marching}
          off={offTable(game, unit)}
          round={game.turn.round}
        />
      )}
      {mine && toGo > 0.05 && (
        <div className="row">
          <span>{t("Move up to {distance} now:", { distance: fmt(toGo) })}</span>
          <button className="primary" onClick={() => dispatch(forwardMove(frame, unit.id, toGo), as)}>
            {t("Forward {distance}", { distance: fmt(toGo) })}
          </button>
          <span className="muted small">{t("or drag, wheel or turn")}</span>
        </div>
      )}
      {mine && (
        <>
          <div className="row">
            <input
              type="number"
              aria-label={t("Inches to move")}
              className="frontage"
              min={0}
              step={0.5}
              value={ahead}
              onChange={(e) => setAhead(Number(e.target.value) || 0)}
            />
            <button onClick={() => dispatch(forwardMove(frame, unit.id, ahead), as)}>{t("Forward")}</button>
            <button title={slowTitle} onClick={() => dispatch(forwardMove(frame, unit.id, -ahead), as)}>
              {t("Back")}
            </button>
            <button title={slowTitle} onClick={() => dispatch(sidewaysMove(frame, unit.id, -ahead), as)}>
              {t("Sideways left")}
            </button>
            <button title={slowTitle} onClick={() => dispatch(sidewaysMove(frame, unit.id, ahead), as)}>
              {t("Sideways right")}
            </button>
            {!activations && (
              <label title={t("A march is double Movement, straight ahead")}>
                <input
                  type="checkbox"
                  checked={marching}
                  onChange={(e) => status("marching", e.target.checked || null)}
                />{" "}
                {t("March")}
              </label>
            )}
          </div>
          <div className="row">
            <input
              type="number"
              aria-label={t("Degrees to wheel")}
              className="frontage"
              min={1}
              max={180}
              step={5}
              value={degrees}
              onChange={(e) => setDegrees(Number(e.target.value) || 0)}
            />
            °
            <button onClick={() => dispatch(wheelMove(frame, unit.id, (-degrees * Math.PI) / 180), as)}>
              {t("Wheel left")}
            </button>
            <button onClick={() => dispatch(wheelMove(frame, unit.id, (degrees * Math.PI) / 180), as)}>
              {t("Wheel right")}
            </button>
            <span className="muted small">{fmt(wheelCost)}</span>
          </div>
          <div className="row">
            <button
              title={t("Costs {distance}", { distance: fmt(cost(summary.turnCost)) })}
              onClick={() => form(summary.ranks, Math.PI / 2, "turn", cost(summary.turnCost))}
            >
              {t("Turn left")}
            </button>
            <button
              title={t("Costs {distance}", { distance: fmt(cost(summary.turnCost)) })}
              onClick={() => form(summary.ranks, -Math.PI / 2, "turn", cost(summary.turnCost))}
            >
              {t("Turn right")}
            </button>
            <button
              title={t("Costs {distance}", { distance: fmt(cost(summary.turnCost * 2)) })}
              onClick={() => form(summary.files, Math.PI, "turn", cost(summary.turnCost * 2))}
            >
              {t("About face")}
            </button>
          </div>
          {!lone && (
            <div className="row">
              <label>
                {t("Frontage")}{" "}
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
                {t("facing")}{" "}
                <select
                  aria-label={t("Facing after reforming")}
                  value={facing}
                  onChange={(e) => setFacing(Number(e.target.value))}
                >
                  {facings().map((f, i) => (
                    <option key={i} value={i}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {redress && (
                <button
                  title={
                    freeRedress
                      ? t(
                          "Add or remove up to {max} models from the front rank; free before moving (Drilled)",
                          {
                            max: summary.redressMax,
                          },
                        )
                      : t("Add or remove up to {max} models from the front rank; costs {distance}", {
                          max: summary.redressMax,
                          distance: fmt(redressDistance),
                        })
                  }
                  onClick={() => {
                    form(frontage, 0, "redress", redressDistance);
                    setFiles(null);
                  }}
                >
                  {t("Redress")}
                </button>
              )}
              <button
                title={t("Rebuild the block around its centre; costs all its move ({distance})", {
                  distance: fmt(cost(summary.reformCost)),
                })}
                onClick={() => {
                  form(frontage, facings()[facing]!.turn, "reform", cost(summary.reformCost));
                  setFiles(null);
                  setFacing(0);
                }}
              >
                {t("Reform")}
              </button>
            </div>
          )}
          {marching && used > 0.05 && (
            <p className="muted small">{t("Marching blocks may only move straight ahead and wheel.")}</p>
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
  manoeuvres,
  marching,
  off,
  round,
}: {
  budget: MoveBudget;
  used: number;
  manoeuvres: Manoeuvre[];
  marching: boolean;
  off: boolean;
  round: number;
}) {
  if (round <= 0) return off ? <p className="warn">{t("Off the table")}</p> : null;
  const allowed = marching ? budget.march : budget.move;
  const over = allowed !== null && used > allowed + 0.05;
  const marchNear = marching && !budget.drilled && budget.nearestEnemy < budget.marchBlock;
  const tooMany = budget.manoeuvreLimit > 0 && manoeuvres.length > budget.manoeuvreLimit;
  const marchManoeuvre = marching && manoeuvres.length > 0;
  return (
    <p className={over || marchNear || off || tooMany || marchManoeuvre ? "warn" : "muted"}>
      {allowed === null
        ? t("Moved {used}", { used: fmt(used) })
        : marching
          ? t("Moved {used} of {allowed} (marching)", { used: fmt(used), allowed: fmt(allowed) })
          : t("Moved {used} of {allowed}", { used: fmt(used), allowed: fmt(allowed) })}
      {over ? <> · {t("over its move")}</> : ""}
      {off ? <> · {t("off the table")}</> : ""}
      {tooMany ? (
        <>
          {" "}
          ·{" "}
          {tn(
            manoeuvres.length,
            "{n} manoeuvre this move ({list}): only one is allowed",
            "{n} manoeuvres this move ({list}): only one is allowed",
            { list: manoeuvres.map(manoeuvreName).join(", ") },
          )}
        </>
      ) : (
        ""
      )}
      {marchManoeuvre ? <> · {t("a marching block may only move ahead and wheel")}</> : ""}
      {marchNear ? (
        <>
          {" "}
          ·{" "}
          {t(
            'an enemy is within {distance}": marching needs a Leadership test (if failed, it moves normally but counts as having marched)',
            { distance: budget.marchBlock },
          )}
        </>
      ) : (
        ""
      )}
    </p>
  );
}

function manoeuvreName(m: Manoeuvre): string {
  switch (m) {
    case "back":
      return t("back");
    case "sideways":
      return t("sideways");
    case "turn":
      return t("turn");
    case "redress":
      return t("redress");
    case "reform":
      return t("reform");
  }
}

function centreOf(game: ReturnType<typeof useGame>, unit: Unit) {
  const ms = unit.modelIds.flatMap((id) => {
    const m = game.models[id];
    return m && !m.destroyed ? [m] : [];
  });
  const n = Math.max(1, ms.length);
  return { x: ms.reduce((a, m) => a + m.position.x, 0) / n, y: ms.reduce((a, m) => a + m.position.y, 0) / n };
}
