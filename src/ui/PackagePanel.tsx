import { useSandbox } from "../sandbox/runtime";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/**
 * A package game's own panel (PanelSpec in src/sdk), worked out in the
 * sandbox after every event and drawn here: lines of text and buttons that
 * start the package's procedures.
 */
export function PackagePanel() {
  const spec = useSandbox((s) => s.app?.panel);
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  if (!spec || scrub !== null) return null;
  const active = Object.values(game.players).find((p) => p.seat === game.turn.activeSeat)?.id;
  return (
    <div className="panel package-panel">
      <strong>{spec.title}</strong>
      {spec.lines?.map((line, i) => (
        <div key={i} className="small">
          {line}
        </div>
      ))}
      {!!spec.buttons?.length && (
        <div className="row wrap">
          {spec.buttons.map((b, i) => {
            const who = b.player ?? active;
            return (
              <button
                key={i}
                disabled={!!b.disabled || !who || !canControl(who) || !!game.script}
                title={b.disabled}
                onClick={() =>
                  who && dispatch({ type: "script/start", procedure: b.procedure, args: b.args ?? {} }, who)
                }
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
