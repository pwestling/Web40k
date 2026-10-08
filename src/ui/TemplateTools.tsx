import { blockFrame, templateHits, unitCentre, type GameState, type Unit, type Vec2 } from "../core";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { useGame } from "./hooks";
import { opposed } from "../core/teams";

/**
 * Templates and special dice, for systems that use them: lay a blast, flame
 * or line (on the selected unit, else mid-table), drag it into place on the
 * table, scatter it, and roll the scatter and artillery dice by hand.
 */
export function TemplateTools() {
  const game = useGame();
  const { dispatch, selected } = useStore();
  const live = useStore((s) => s.scrub === null && s.role !== "spectator");
  const canControl = useCanControl();
  const mod = systemModule(game.system);
  if (!mod.templates?.length && !mod.specialDice?.length) return null;
  const dice = mod.specialDice ?? [];
  const die = (id: string) => dice.find((d) => d.id === id);
  const sel = selected ? game.units[selected] : undefined;
  const templates = Object.values(game.templates ?? {});

  // A blast lands on the target: the selected unit when it's an enemy, else the
  // enemy nearest the selected unit (the shooter). Flames and lines start at
  // the shooter and point at the target.
  const own = sel && canControl(sel.owner) ? sel : undefined;
  const target = own ? nearestEnemy(game, own) : sel;
  const place = (kind: NonNullable<typeof mod.templates>[number]) => {
    const frame = own ? blockFrame(game, own) : null;
    const goal = target ? unitCentre(game, target) : { x: 0, y: 0 };
    const at: Vec2 = kind.shape === "circle" || !own ? goal : (frame?.front ?? unitCentre(game, own));
    const dx = goal.x - at.x;
    const dy = goal.y - at.y;
    const len = Math.hypot(dx, dy);
    const facing = len > 0.01 ? Math.atan2(dx, dy) : (frame?.facing ?? 0);
    const to = { x: at.x + Math.sin(facing) * kind.size, y: at.y + Math.cos(facing) * kind.size };
    const id = `${kind.id}-${game.seq + 1}`;
    dispatch({
      type: "template/set",
      id,
      template: {
        id,
        shape: kind.shape,
        size: kind.size,
        label: kind.label,
        at,
        ...(kind.shape === "circle" ? {} : { to }),
        ...(kind.width ? { width: kind.width } : {}),
      },
    });
  };

  const scatterDice = mod.scatter && die(mod.scatter.direction) && die(mod.scatter.distance);
  return (
    <details className="fold templates">
      <summary>Templates{templates.length ? ` (${templates.length})` : ""}</summary>
      {live && (
        <div className="row wrap">
          {(mod.templates ?? []).map((k) => (
            <button
              key={k.id}
              title={target ? `Lay it on ${target.name}` : "Lay it mid-table (select a unit to aim it)"}
              onClick={() => place(k)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      {templates.length > 0 && (
        <ul className="template-list">
          {templates.map((t) => {
            const hits = templateHits(game, t);
            return (
              <li key={t.id}>
                <strong>{t.label ?? "Template"}</strong>
                {hits.length === 0 && <span className="muted"> · no models under it</span>}
                {hits.map((h) => (
                  <div key={h.unitId ?? "-"} className="muted small">
                    {h.unitId ? (game.units[h.unitId]?.name ?? "?") : "Models"}:{" "}
                    {t.shape === "line" ? `${h.partial} touched` : `${h.full} under, ${h.partial} partly`}
                  </div>
                ))}
                {live && (
                  <span className="row">
                    {t.shape === "circle" && scatterDice && (
                      <button
                        title="Roll the scatter and artillery dice and move it"
                        onClick={() =>
                          dispatch({
                            type: "template/scatter",
                            id: t.id,
                            scatter: die(mod.scatter!.direction)!.faces,
                            distance: die(mod.scatter!.distance)!.faces,
                            label: t.label,
                          })
                        }
                      >
                        Scatter
                      </button>
                    )}
                    <button onClick={() => dispatch({ type: "template/set", id: t.id, template: null })}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {live && dice.length > 0 && (
        <div className="row wrap">
          {dice.map((d) => (
            <button
              key={d.id}
              onClick={() =>
                dispatch({
                  type: "dice/roll",
                  count: 1,
                  sides: d.faces.length,
                  faces: d.faces,
                  label: `${d.name.toLowerCase()} die`,
                })
              }
            >
              Roll {d.name.toLowerCase()} die
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Drag a template to move it; drag its round handle to aim it.</p>
    </details>
  );
}

function nearestEnemy(game: GameState, unit: Unit): Unit | undefined {
  const c = unitCentre(game, unit);
  let best: { u: Unit; d: number } | undefined;
  for (const u of Object.values(game.units)) {
    if (
      !opposed(game, u.owner, unit.owner) ||
      !u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed)
    )
      continue;
    const p = unitCentre(game, u);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (!best || d < best.d) best = { u, d };
  }
  return best?.u;
}
