import { useEffect, type ReactNode } from "react";
import type { Intent } from "../core";
import { phaseName } from "../core/content/turn";
import { systemModule } from "../systems";
import { belowHalf } from "../systems/wh40k/module";
import { mainWeapon } from "../systems/wh40k/rules";
import { RollButton } from "../companion/RealDice";
import { doTableVerb, tableVerb } from "./tableVerbs";
import { t } from "../i18n";
import { talkOrNote } from "../replay/notes";
import { snapTurn } from "../render/touchTurn";
import { useTouch } from "../render/touchState";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { touch } from "./touch";
import { eyeView, rotateUnit } from "./UnitCard";
import { isBlock, opposed } from "../core";

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
  const { view, select, setView, resetView, scrub, selected } = useStore();
  const unit = menu.unitId ? game.units[menu.unitId] : undefined;
  // An enemy: not yours, or (hotseat) the other side from the unit you have picked (UX 502).
  const picked = selected && selected !== unit?.id ? game.units[selected] : undefined;
  const enemy =
    !!unit &&
    (!canControl(unit.owner) ||
      (!!picked && canControl(picked.owner) && opposed(game, unit.owner, picked.owner)));
  const mine = !!unit && !enemy && scrub === null;
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
        {unit && <UnitVerbs unitId={unit.id} close={close} />}
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
        {unit && enemy && (
          <button role="menuitem" onClick={run(() => select(unit.id))}>
            {t("Its card")}
          </button>
        )}
        {/* The camera and box selection belong to a spot, not a unit (UX 502). */}
        {!unit && (
          <>
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
          </>
        )}
        <p className="muted small">{menu.mouse ? t("M to measure.") : t("Hold, then drag, to measure.")}</p>
      </div>
    </>
  );
}

/**
 * The unit's verbs at the unit (UX 84, proposal 3): this phase's first, the rest under "Out of phase";
 * on an enemy, what your picked unit can do to it. The same menu opens on a right-click or a long press.
 */
function UnitVerbs({ unitId, close }: { unitId: string; close: () => void }) {
  const game = useGame();
  const canControl = useCanControl();
  const { selected, select, setDraft, scrub } = useStore();
  const unit = game.units[unitId];
  if (!unit || scrub !== null || !systemModule(game.system).dedicatedUi || game.turn.round === 0) return null;
  const as = unit.owner;
  // Your picked unit and this one on opposite sides: what it does to this one, in reach or anyway.
  const verb =
    selected && selected !== unitId && canControl(game.units[selected]?.owner ?? "")
      ? tableVerb(game, selected, unitId)
      : null;
  const onIt = verb && selected && (
    <button
      role="menuitem"
      className={verb.ok ? "primary" : ""}
      title={verb.facts.join(" · ")}
      onClick={() => {
        doTableVerb(verb, selected, unitId);
        close();
      }}
    >
      {verb.ok
        ? t("{verb}: {unit}", { verb: verb.line, unit: game.units[selected]!.name })
        : t("{verb} anyway ({why})", {
            verb: { shoot: t("Shoot"), charge: t("Charge"), fight: t("Fight") }[verb.verb],
            why: verb.line,
          })}
    </button>
  );
  // Hotseat controls both sides: with one of yours picked, the other side offers what it does to them.
  if (!canControl(as) || onIt) return onIt || null;
  const phase = phaseName(game);
  const roll = (label: string, count: number): Intent => ({
    type: "dice/roll",
    count,
    sides: 6,
    label,
    unitId,
  });
  const pick =
    (kind: "ranged" | "melee", all = false) =>
    () => {
      select(unitId);
      setDraft({ attackerId: unitId, kind, picking: true, ...(all ? { all: true } : {}) });
      close();
    };
  const verbs: [string, ReactNode][] = [];
  if (mainWeapon(game, unit, "ranged"))
    verbs.push([
      "Shooting",
      <button key="shoot" role="menuitem" onClick={pick("ranged", true)}>
        {t("Shoot…")}
      </button>,
    ]);
  verbs.push([
    "Movement",
    <RollButton key="advance" intent={roll("advance", 1)} as={as} onRolled={close}>
      {t("Advance (D6)")}
    </RollButton>,
  ]);
  verbs.push([
    "Charge",
    <button
      key="charge"
      role="menuitem"
      title={t("Then click the enemy to charge")}
      onClick={() => {
        select(unitId);
        close();
      }}
    >
      {t("Charge…")}
    </button>,
  ]);
  if (mainWeapon(game, unit, "melee"))
    verbs.push([
      "Fight",
      <button key="fight" role="menuitem" onClick={pick("melee")}>
        {t("Fight…")}
      </button>,
    ]);
  verbs.push([
    belowHalf({ state: game }, unitId) ? "Command" : "",
    <RollButton key="shock" intent={roll("battleshock", 2)} as={as} onRolled={close}>
      {t("Battle-shock test")}
    </RollButton>,
  ]);
  const now = verbs.filter(([p]) => p === phase);
  const later = verbs.filter(([p]) => p !== phase);
  return (
    <>
      {now.map(([, b]) => b)}
      <details className="out-of-phase">
        <summary className="muted small">{t("Out of phase ▸")}</summary>
        {later.map(([, b]) => b)}
      </details>
    </>
  );
}
