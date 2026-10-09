import { battleOver } from "./StatsScreen";
import { useState } from "react";
import type { Unit } from "../core";
import { currentSlot, plainActivations } from "../core/content/turn";
import { gameView, toldFor } from "../core/script";
import { useCanControl, useStore } from "../store";
import { usePackageActions } from "../sandbox/runtime";
import type { ActionRow } from "../sandbox/protocol";
import { gameModule } from "../systems";
import { useGame } from "./hooks";
import { t, tn } from "../i18n";

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
  // After Battle over the table is for looking back: no actions to start.
  if (scrub !== null || battleOver(game)) return null;
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
  // In alternating activations, only the side whose go it is acts.
  const onTurn = (u: Unit) =>
    !plainActivations(game) || game.turn.round === 0 || game.players[u.owner]?.seat === game.turn.activeSeat;
  const rows = actions.map((a) => {
    const ok = a.available;
    const targets = a.targets;
    const target = picked[a.id] ?? targets[0]?.unitId;
    const questions = a.told?.[target ?? ""] ?? [];
    const key = `${a.id}:${target ?? ""}`;
    const answers = told[key] ?? {};
    const missing = questions.find((q) => q.need && !answers[q.id]);
    const why = ok !== true ? ok : busy ? "Another rule is still being resolved" : null;
    // Not this side's to take: say so rather than grey it out with no reason (UX 363).
    const notYours = !mine ? t("Not your unit") : !onTurn(unit) ? t("Not this side's go") : null;
    return {
      ready: !notYours && !why,
      row: (
        <div key={a.id} className="code-action">
          <div className="row">
            <button
              // Lit once everything it needs is answered (PX print and play).
              className={questions.length && !missing && !notYours && !why ? "primary" : undefined}
              disabled={!!notYours || !!why || (a.targeted && !target) || !!missing}
              title={notYours ?? why ?? undefined}
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
            {(notYours || why) && <span className="muted small"> {notYours ?? why}</span>}
          </div>
          {!notYours && !why && questions.length > 0 && (
            // One question a row, the box first; the ones that may be left unticked say so (UX 359).
            <div className="told" role="group" aria-label={t("On the table")}>
              {questions.map((q) => (
                <label key={q.id} className={q.need && !answers[q.id] ? "need" : ""}>
                  <input
                    type="checkbox"
                    checked={!!answers[q.id]}
                    onChange={(e) => setTold({ ...told, [key]: { ...answers, [q.id]: e.target.checked } })}
                  />
                  <span>
                    {q.question}
                    {!q.need && <span className="muted small"> {t("(optional)")}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ),
    };
  });
  const later = rows.filter((r) => !r.ready);
  // Only what can be taken now stays out; the rest folds, so the stats stay in view (UX 401).
  return (
    <div className="code-actions">
      {rows.filter((r) => r.ready).map((r) => r.row)}
      {later.length > 0 && (
        <details className="code-later">
          <summary className="muted small">
            {tn(later.length, "{n} more, not now", "{n} more, not now")}
          </summary>
          {later.map((r) => r.row)}
        </details>
      )}
    </div>
  );
}
