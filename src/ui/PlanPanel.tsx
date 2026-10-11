import { useEffect } from "react";
import { t, tn } from "../i18n";
import { useCanControl, useStore } from "../store";
import { useTalk } from "../talk/talk";
import { useGame } from "./hooks";
import { battleOver } from "./StatsScreen";
import {
  forgetPlan,
  inPhase,
  moveAsPlanned,
  movesReady,
  planFor,
  setPlanning,
  shootAsPlanned,
  shotsReady,
  usePlan,
} from "./plan";

/**
 * Planning your next turn while the other player takes theirs (#81). On their
 * turn: "Plan my turn", then drags leave ghosts and clicking an enemy with
 * your unit picked aims it. On yours: "Move as planned" in Movement and
 * "Shoot as planned" in Shooting. Only this screen ever sees the plan.
 */
export function PlanPanel() {
  const game = useGame();
  const record = useStore((s) => s.record);
  const self = useStore((s) => s.session?.selfId ?? null);
  const role = useStore((s) => s.role);
  const scrub = useStore((s) => s.scrub);
  const canControl = useCanControl();
  const on = usePlan((s) => s.on);
  const moves = usePlan((s) => s.moves);
  const shots = usePlan((s) => s.shots);
  useEffect(() => {
    planFor(record);
  }, [record]);
  useEffect(() => {
    document.body.dataset.planning = on ? "1" : "";
  }, [on]);
  // Watching someone's table, or looking back: nothing to plan.
  if (!self || role === "spectator" || scrub !== null || game.turn.round < 1 || battleOver(game)) return null;
  const seat = game.players[self]?.seat;
  if (seat === undefined) return null;
  const yours = game.turn.activeSeat === seat;
  const mine = (id: string) => canControl(id);
  if (!yours) {
    const planned = [...new Set([...Object.keys(moves), ...Object.keys(shots)])].filter(
      (id) => game.units[id],
    );
    return (
      <div className={on ? "plan-panel on" : "plan-panel"} data-testid="plan-panel">
        <button className={on ? "small primary" : "small"} aria-pressed={on} onClick={() => setPlanning(!on)}>
          {on ? t("Done planning") : t("Plan my turn")}
        </button>
        {on && (
          <span className="plan-hint">
            {t("Drag your models to plan moves; pick a unit, then click an enemy to plan its shots.")}
          </span>
        )}
        {planned.length > 0 && (
          <ul className="plan-list">
            {planned.map((id) => (
              <li key={id}>
                <span>
                  {game.units[id]!.name}
                  {moves[id] ? ` · ${t("move")}` : ""}
                  {shots[id] && game.units[shots[id]!]
                    ? ` · ${t("shoot {name}", { name: game.units[shots[id]!]!.name })}`
                    : ""}
                </span>
                <button
                  className="small quiet"
                  aria-label={t("Forget this plan")}
                  onClick={() => forgetPlan(id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const moving = inPhase(game, "movement") ? movesReady(game, mine) : [];
  const shooting = inPhase(game, "shooting") && !game.attack ? shotsReady(game, mine) : [];
  if (!moving.length && !shooting.length) return null;
  return (
    <div className="plan-panel go" data-testid="plan-panel">
      {moving.length > 0 && (
        <button className="primary" onClick={() => moveAsPlanned(moving)}>
          {tn(moving.length, "Move as planned ({n} unit)", "Move as planned ({n} units)")}
        </button>
      )}
      {shooting.length > 0 && (
        <button className="primary" onClick={() => shootAsPlanned(shooting)}>
          {tn(shooting.length, "Shoot as planned ({n} unit)", "Shoot as planned ({n} units)")}
        </button>
      )}
    </div>
  );
}

/** Whoever else is planning their next turn: only that they are, never what (#81). */
export function OthersPlanning() {
  const planning = useTalk((s) => s.planning);
  const players = useStore((s) => s.game.players);
  const active = useStore((s) => s.game.turn.activeSeat);
  const self = useStore((s) => s.session?.selfId);
  const who = Object.keys(planning).filter(
    (id) => id !== self && players[id] && players[id]!.seat !== active,
  );
  if (!who.length) return null;
  return (
    <div className="others-planning" role="status">
      {who.map((id) => (
        <span key={id} style={{ color: players[id]?.color }}>
          {t("{name} is planning…", { name: players[id]?.name ?? "" })}
        </span>
      ))}
    </div>
  );
}
