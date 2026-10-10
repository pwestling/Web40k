import { useEffect } from "react";
import { t } from "../i18n";
import { talkOrNote } from "../replay/notes";
import { snapTurn } from "../render/touchTurn";
import { useTouch } from "../render/touchState";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { touch } from "./touch";
import { eyeView, rotateUnit } from "./UnitCard";
import { isBlock } from "../core";

/**
 * Touch play (#60), around the board: the box Select several draws, the turn a twist will set down, the
 * menu a long press opens (what a mouse and keyboard do with keys and modifiers, and two modes a finger
 * can't hold down as Shift: Select several and One model), and a line saying which mode is on.
 */
export function TouchLayer() {
  const { box, twist, menu, boxMode, oneModel, picked } = useTouch();
  const game = useGame();
  const live = useStore((s) => s.scrub === null);
  // Esc, or the game moving on, closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && useTouch.setState({ menu: null });
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  if (!touch() && !menu && !box && !twist && picked.length < 2) return null;
  const twisted = twist ? game.units[twist.unitId] : undefined;
  const degrees = twist ? Math.round((snapTurn(twist.angle) * 180) / Math.PI) : 0;
  return (
    <>
      {box && (
        <div
          className="touch-box"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
      {twist && twisted && (
        <div className="touch-twist" style={{ left: twist.x, top: twist.y - 70 }}>
          {degrees === 0
            ? t("Twist to turn")
            : isBlock(twisted)
              ? degrees > 0
                ? t("Wheel {n}° right", { n: degrees })
                : t("Wheel {n}° left", { n: -degrees })
              : degrees > 0
                ? t("Turn {n}° right", { n: degrees })
                : t("Turn {n}° left", { n: -degrees })}
        </div>
      )}
      {menu && <TouchMenu />}
      {/* Select several and One model are switched on from a long press's menu; while one is on, it says so here. */}
      {/* A box drawn with TTS controls picks several too: it says so the same way. */}
      {live && (boxMode || oneModel || picked.length > 1) && (
        <div className="touch-tools" role="status">
          <span>
            {picked.length > 1
              ? t("{n} units picked: drag one to move them all", { n: picked.length })
              : boxMode
                ? t("Draw a box on the table around your units")
                : t("Dragging moves one model at a time")}
          </span>
          <button
            className="primary"
            onClick={() => useTouch.setState({ boxMode: false, oneModel: false, picked: [] })}
          >
            {t("Done")}
          </button>
        </div>
      )}
    </>
  );
}

/** A long press's menu: on a unit, or on a spot on the table. */
function TouchMenu() {
  const menu = useTouch((s) => s.menu)!;
  const game = useGame();
  const canControl = useCanControl();
  const { view, select, setView, resetView, scrub } = useStore();
  const unit = menu.unitId ? game.units[menu.unitId] : undefined;
  const mine = !!unit && canControl(unit.owner) && scrub === null;
  const close = () => useTouch.setState({ menu: null });
  const run = (f: () => void) => () => {
    f();
    close();
  };
  // Kept on screen, beside the finger rather than under it.
  const left = Math.max(8, Math.min(menu.x + 16, innerWidth - 248));
  const top = Math.max(8, Math.min(menu.y - 24, innerHeight - 340));
  return (
    <>
      <div className="touch-menu-scrim" onPointerDown={close} />
      <div
        className="touch-menu"
        role="menu"
        aria-label={unit ? unit.name : t("This spot")}
        style={{ left, top }}
      >
        <strong className="small">{unit ? unit.name : t("This spot")}</strong>
        {unit && mine && (
          <>
            <div className="row">
              <button role="menuitem" onClick={run(() => rotateUnit(unit.id, -1))}>
                {t("Turn {n}° left", { n: 15 })} ↺
              </button>
              <button role="menuitem" onClick={run(() => rotateUnit(unit.id, 1))}>
                {t("Turn {n}° right", { n: 15 })} ↻
              </button>
            </div>
            <button
              role="menuitem"
              className={useTouch.getState().oneModel ? "on" : ""}
              onClick={run(() => useTouch.setState((s) => ({ oneModel: !s.oneModel, boxMode: false })))}
            >
              {t("Move one model at a time")}
            </button>
          </>
        )}
        {unit && (
          <button
            role="menuitem"
            onClick={run(() => {
              select(unit.id);
              eyeView(unit.id);
            })}
          >
            {t("Look from here")}
          </button>
        )}
        <button
          role="menuitem"
          onClick={run(() =>
            talkOrNote(unit ? { kind: "ping", at: menu.at, unitId: unit.id } : { kind: "ping", at: menu.at }),
          )}
        >
          {unit ? t("Ping this unit") : t("Ping here")}
        </button>
        <button
          role="menuitem"
          onClick={run(() => useTouch.setState((s) => ({ boxMode: !s.boxMode, oneModel: false })))}
        >
          {t("Select several")}
        </button>
        <button role="menuitem" onClick={run(() => setView(view === "top" ? "3d" : "top"))}>
          {view === "top" ? t("3D view") : t("Top-down view")}
        </button>
        <button role="menuitem" onClick={run(resetView)}>
          {t("Reset view")}
        </button>
        <p className="muted small">{t("Hold, then drag, to measure.")}</p>
      </div>
    </>
  );
}
