import { useState } from "react";
import type { Unit } from "../core";
import { currentSlot } from "../core/content/turn";
import { gameView } from "../core/script";
import { useCanControl, useStore } from "../store";
import { gameModule } from "../systems";
import { useGame } from "./hooks";

/**
 * A game module's code actions for this unit (sdk CodeAction): those for the
 * current phase, with why one isn't available, and a target to pick when it
 * takes one. Taking one starts its code procedure on the host.
 */
export function CodeActions({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const mod = gameModule(game.system);
  if (!mod?.actions?.length || scrub !== null) return null;
  const phase = currentSlot(game)?.id;
  const actions = mod.actions.filter(
    (a) => a.by === "unit" && (!a.phases || (phase && a.phases.includes(phase))),
  );
  if (!actions.length) return null;
  const view = gameView(game, mod.system.id);
  const actor = { player: unit.owner, unitId: unit.id };
  const mine = canControl(unit.owner);
  const busy = !!game.script;
  return (
    <div className="code-actions">
      {actions.map((a) => {
        const ok = a.available(view, actor);
        const targets = ok === true && a.targets ? a.targets(view, actor) : [];
        const target = picked[a.id] ?? targets[0]?.unitId;
        const why = ok !== true ? ok : busy ? "Another rule is still being resolved" : null;
        return (
          <div key={a.id} className="row">
            <button
              disabled={!mine || !!why || (!!a.targets && !target)}
              title={why ?? undefined}
              onClick={() =>
                dispatch(
                  {
                    type: "script/start",
                    procedure: a.id,
                    args: { unit: unit.id, ...(target ? { target } : {}) },
                  },
                  unit.owner,
                )
              }
            >
              {a.name}
            </button>
            {targets.length > 1 && (
              <select value={target} onChange={(e) => setPicked({ ...picked, [a.id]: e.target.value })}>
                {targets.map((t) => (
                  <option key={t.unitId} value={t.unitId}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            {targets.length === 1 && <span className="muted"> {targets[0]!.label}</span>}
            {why && mine && <span className="muted small"> {why}</span>}
          </div>
        );
      })}
    </div>
  );
}
