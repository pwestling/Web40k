import { useState } from "react";
import type { Unit } from "../core";
import { currentSlot } from "../core/content/turn";
import { gameView, toldFor } from "../core/script";
import { useCanControl, useStore } from "../store";
import { usePackageActions } from "../sandbox/runtime";
import type { ActionRow } from "../sandbox/protocol";
import { gameModule } from "../systems";
import { useGame } from "./hooks";
import { t } from "../i18n";

/**
 * A game module's code actions for this unit (sdk CodeAction): those for the
 * current phase, with why one isn't available, and a target to pick when it
 * takes one. Taking one starts its code procedure on the host. Actions from
 * rules packages are worked out in the package sandbox and listed after.
 */
export function CodeActions({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  const [picked, setPicked] = useState<Record<string, string>>({});
  // At a real table, the players' answers per action and target (CodeAction.told).
  const [told, setTold] = useState<Record<string, Record<string, boolean>>>({});
  const fromPackages = usePackageActions(unit);
  const mod = gameModule(game.system);
  if (scrub !== null) return null;
  const phase = currentSlot(game)?.id;
  const phased = (mod?.actions ?? []).filter(
    (a) => a.by === "unit" && (!a.phases || (phase && a.phases.includes(phase))),
  );
  const view = mod ? gameView(game, mod.system.id) : null;
  const actor = { player: unit.owner, unitId: unit.id };
  const builtIn: ActionRow[] = view
    ? phased
        .filter((a) => !a.applies || a.applies(view, actor))
        .map((a) => {
          const available = a.available(view, actor);
          const targets = available === true && a.targets ? a.targets(view, actor) : [];
          return {
            id: a.id,
            name: a.label?.(view, actor) ?? a.name,
            available,
            targets,
            targeted: !!a.targets,
            ...toldFor(a, view, actor, targets),
          };
        })
    : [];
  const actions = [...builtIn, ...fromPackages.filter((r) => !builtIn.some((b) => b.id === r.id))];
  if (!actions.length) return null;
  const mine = canControl(unit.owner);
  const busy = !!game.script;
  return (
    <div className="code-actions">
      {actions.map((a) => {
        const ok = a.available;
        const targets = a.targets;
        const target = picked[a.id] ?? targets[0]?.unitId;
        const questions = a.told?.[target ?? ""] ?? [];
        const key = `${a.id}:${target ?? ""}`;
        const answers = told[key] ?? {};
        const missing = questions.find((q) => q.need && !answers[q.id]);
        const why = ok !== true ? ok : busy ? "Another rule is still being resolved" : null;
        return (
          <div key={a.id} className="code-action">
            <div className="row">
              <button
                disabled={!mine || !!why || (a.targeted && !target) || !!missing}
                title={why ?? undefined}
                onClick={() =>
                  dispatch(
                    {
                      type: "script/start",
                      procedure: a.id,
                      args: {
                        unit: unit.id,
                        ...(target ? { target } : {}),
                        ...(questions.length
                          ? { told: Object.fromEntries(questions.map((q) => [q.id, !!answers[q.id]])) }
                          : {}),
                      },
                    },
                    unit.owner,
                  )
                }
              >
                {a.name}
              </button>
              {targets.length > 1 && (
                <select
                  aria-label={t("Target for {action}", { action: a.name })}
                  value={target}
                  onChange={(e) => setPicked({ ...picked, [a.id]: e.target.value })}
                >
                  {targets.map((x) => (
                    <option key={x.unitId} value={x.unitId}>
                      {x.label}
                    </option>
                  ))}
                </select>
              )}
              {targets.length === 1 && <span className="muted"> {targets[0]!.label}</span>}
              {why && mine && <span className="muted small"> {why}</span>}
            </div>
            {mine && !why && questions.length > 0 && (
              <div className="told">
                {questions.map((q) => (
                  <label key={q.id} className={q.need && !answers[q.id] ? "need" : ""}>
                    <input
                      type="checkbox"
                      checked={!!answers[q.id]}
                      onChange={(e) => setTold({ ...told, [key]: { ...answers, [q.id]: e.target.checked } })}
                    />{" "}
                    {q.question}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
