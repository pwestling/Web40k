import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { diceWanted, type Intent, type PlayerId } from "../core";
import { t } from "../i18n";
import { useStore } from "../store";
import { rattle, whoosh } from "../ui/sound";

/**
 * Hold to shake (PX-1f, hold-to-shake.md; mode A of UX 501): with "Roll the
 * dice myself" on, a roll button can be held. The dice rattle in your hand
 * while you hold it, and letting go sends the roll. The host rolls it then,
 * as ever: how long or how hard you shook changes nothing, and nothing of
 * the shake is logged. A quick tap rolls at once.
 */

/** Shorter than this is a tap: it rolls at once, with no shake. */
const TAP_MS = 150;
/** The shake builds up to its full speed over this long. */
const BUILD_MS = 800;
/** Held this long, a hint to let go. */
const HINT_MS = 6000;
/** Past this many dice the hand shows a heap that rattles as one. */
const HEAP = 12;

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Held = { since: number; dice: { count: number; sides: number } | null; color: string };

/**
 * The press-and-hold behind a roll button: spread the returned handlers on
 * the button, and render `tray` beside it.
 */
export function useHoldToShake(on: boolean, intent: Intent, as: PlayerId | undefined, roll: () => void) {
  const [held, setHeld] = useState<Held | null>(null);
  const [now, setNow] = useState(0);
  const pressed = useRef<{ at: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const start = () => {
    if (pressed.current) return;
    const at = performance.now();
    pressed.current = {
      at,
      timer: setTimeout(() => {
        const { record, game, session } = useStore.getState();
        const by = as ?? session?.selfId ?? "local";
        let dice: Held["dice"] = null;
        try {
          const wanted = diceWanted(record, intent, by, [], game);
          if (wanted && wanted !== "bad") dice = { count: wanted.count, sides: wanted.sides };
        } catch {
          // Can't say how many: the hand still shakes.
        }
        setHeld({ since: performance.now(), dice, color: game.players[by]?.color ?? "#e5e7eb" });
      }, TAP_MS),
    };
  };
  const release = () => {
    const p = pressed.current;
    if (!p) return;
    clearTimeout(p.timer);
    pressed.current = null;
    if (held) whoosh();
    setHeld(null);
    roll();
  };
  const cancel = () => {
    if (pressed.current) clearTimeout(pressed.current.timer);
    pressed.current = null;
    setHeld(null);
  };

  // While held: the rattle, faster as the shake builds; the release can come anywhere on the page.
  const holding = held !== null;
  useEffect(() => {
    if (!holding) return;
    let timer: ReturnType<typeof setTimeout>;
    const began = performance.now();
    const tick = () => {
      const built = Math.min(1, (performance.now() - began) / BUILD_MS);
      rattle();
      if (typeof navigator !== "undefined") navigator.vibrate?.(6);
      setNow(performance.now());
      timer = setTimeout(tick, 230 - 140 * built);
    };
    tick();
    return () => clearTimeout(timer);
  }, [holding]);
  useEffect(() => () => cancel(), []);

  if (!on)
    return {
      handlers: { onClick: roll },
      tray: null,
    };
  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      },
      onPointerUp: release,
      onPointerCancel: cancel,
      // Enter rolls at once; Space can be held like the mouse.
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === " ") {
          e.preventDefault();
          if (!e.repeat) start();
        } else if (e.key === "Enter") {
          e.preventDefault();
          roll();
        }
      },
      onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== " ") return;
        e.preventDefault();
        release();
      },
      onBlur: cancel,
    },
    tray: held ? <ShakeTray held={held} now={now} /> : null,
  };
}

/** The dice in your hand, shaking, where the dice tray rolls them. */
function ShakeTray({ held, now }: { held: Held; now: number }) {
  const long = now - held.since > HINT_MS;
  const built = Math.min(1, Math.max(0, (now - held.since) / BUILD_MS));
  const count = held.dice?.count ?? 3;
  const heap = count > HEAP;
  const shown = heap ? 6 : count;
  return createPortal(
    <div
      className={`shake-tray ${reduced() ? "still" : ""}`}
      style={{ "--side": held.color, "--shake": 0.4 + 0.6 * built } as CSSProperties}
      role="status"
      aria-live="polite"
    >
      <div className={`hand ${heap ? "heap" : ""}`}>
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="shake-die" style={{ "--n": i } as CSSProperties} />
        ))}
        {heap && <span className="heap-count">×{count}</span>}
      </div>
      <span className="small">{long ? t("Let go to roll") : t("Shaking… let go to roll")}</span>
    </div>,
    document.body,
  );
}
