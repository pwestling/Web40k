import { blockFrame, templateHits, unitCentre, type Vec2 } from "../core";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { useGame } from "./hooks";

/**
 * Templates and special dice, for systems that use them: lay a blast, flame
 * or line (on the selected unit, else mid-table), drag it into place on the
 * table, scatter it, and roll the scatter and artillery dice by hand.
 */
export function TemplateTools() {
  const game = useGame();
  const { dispatch, selected } = useStore();
  const live = useStore((s) => s.scrub === null && s.role !== "spectator");
  const mod = systemModule(game.system);
  if (!mod.templates?.length && !mod.specialDice?.length) return null;
  const dice = mod.specialDice ?? [];
  const die = (id: string) => dice.find((d) => d.id === id);
  const sel = selected ? game.units[selected] : undefined;
  const templates = Object.values(game.templates ?? {});

  const place = (kind: NonNullable<typeof mod.templates>[number]) => {
    const frame = sel ? blockFrame(game, sel) : null;
    const at: Vec2 = sel ? (frame?.front ?? unitCentre(game, sel)) : { x: 0, y: 0 };
    const facing = frame?.facing ?? (sel ? (game.models[sel.modelIds[0] ?? ""]?.facing ?? 0) : 0);
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
        at: kind.shape === "circle" && sel ? unitCentre(game, sel) : at,
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
              title={sel ? `Lay it on ${sel.name}` : "Lay it mid-table"}
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
            const full = hits.reduce((a, h) => a + h.full, 0);
            const partial = hits.reduce((a, h) => a + h.partial, 0);
            return (
              <li key={t.id}>
                <strong>{t.label ?? "Template"}</strong>{" "}
                <span className="muted">
                  {t.shape === "line" ? `${partial} touched` : `${full} under, ${partial} partly`}
                </span>
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
