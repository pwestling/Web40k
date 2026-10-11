import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { tableVerb, useDragVerb } from "./tableVerbs";

/**
 * The tag by the pointer when one of your units is picked and an enemy is
 * under it (UX 84): what a click does this phase, with the facts (weapons
 * that reach, distance, sight, cover, the charge roll needed), or why not
 * and that Shift+click does it anyway. Facts only: no odds in a live game.
 */
export function TableTag() {
  const game = useGame();
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hoverUnit);
  const live = useStore((s) => s.scrub === null && !s.draft);
  const canControl = useCanControl();
  const mine = !!selected && !!game.units[selected] && canControl(game.units[selected]!.owner);
  const verb = useMemo(
    () => (live && mine && selected && hover ? tableVerb(game, selected, hover) : null),
    [game, live, mine, selected, hover],
  );
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!verb) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAt({ x: e.clientX, y: e.clientY }));
    };
    addEventListener("pointermove", move);
    document.body.classList.toggle("verb-ok", verb.ok);
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
      document.body.classList.remove("verb-ok");
    };
  }, [verb]);
  if (!verb || !at) return null;
  const left = Math.min(at.x + 18, innerWidth - 300);
  const top = Math.min(at.y + 18, innerHeight - 90);
  return (
    <div className={`table-tag ${verb.ok ? "ok" : "no"}`} style={{ left, top }} role="status">
      <strong>{verb.ok ? `${verb.line} ▸` : verb.line}</strong>
      {verb.facts.length > 0 && <span className="small">{verb.facts.join(" · ")}</span>}
      <span className="muted small">
        {verb.ok
          ? t("Click to do it")
          : t("Click: its card · Shift+click: {verb} anyway", {
              verb: { shoot: t("shoot"), charge: t("charge"), fight: t("fight") }[verb.verb],
            })}
      </span>
    </div>
  );
}

/** Dragging a unit onto an enemy in the Charge phase: what letting go there does (UX 84, #2). */
export function DragTag() {
  const drag = useDragVerb((s) => s.drag);
  if (!drag) return null;
  const { verb } = drag;
  const left = Math.min(drag.x + 22, innerWidth - 300);
  const top = Math.min(drag.y + 22, innerHeight - 90);
  return (
    <div className={`table-tag ${verb.ok ? "ok" : "no"}`} style={{ left, top }} role="status">
      <strong>{verb.ok ? `${verb.line} ▸` : verb.line}</strong>
      {verb.facts.length > 0 && <span className="small">{verb.facts.join(" · ")}</span>}
      <span className="muted small">
        {verb.verb === "attach"
          ? verb.ok
            ? t("Let go to attach it")
            : t("Let go to attach it anyway")
          : verb.ok
            ? t("Let go to declare the charge")
            : t("Let go to charge anyway")}
      </span>
    </div>
  );
}
