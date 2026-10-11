import { useEffect, useRef, useState } from "react";
import { diceWanted, type Intent, type PlayerId } from "../core";
import { t } from "../i18n";
import { useStore } from "../store";
import { trayHand } from "../ui/DiceTray";
import { tableDrag } from "../render/dragging";
import { diceLook } from "../ui/diceSets";
import { whoosh, rattle } from "../ui/sound";
import { sendShaking, useTalk } from "../talk/talk";

/**
 * Hold to shake (PX-1f, hold-to-shake.md; mode A of UX 501): with "Roll the
 * dice myself" on, a roll can be held. The dice rattle in the felt tray while
 * you hold, and letting go throws them: the roll is sent then, and the host
 * rolls it as ever. How long or how hard you shook changes nothing, and
 * nothing of the shake is logged. A quick tap rolls at once.
 */

/** Shorter than this is a tap: it rolls at once, with no shake. */
const TAP_MS = 150;
/** The shake builds up to its full speed over this long. */
const BUILD_MS = 800;
/** Held this long, a hint to let go. */
const HINT_MS = 6000;

/** The dice a roll will throw, in the roller's own set, for the hand: null when it can't say. */
function handFor(intent: Intent, as: PlayerId | undefined) {
  const { record, game, session } = useStore.getState();
  const by = as ?? session?.selfId ?? "local";
  let dice: { count: number; sides: number } | null = null;
  try {
    const wanted = diceWanted(record, intent, by, [], game);
    if (wanted && wanted !== "bad") dice = { count: wanted.count, sides: wanted.sides };
  } catch {
    // Can't say how many: three in the hand.
  }
  const defender = intent.type === "attack/roll" && game.attack?.stage === "save";
  return {
    count: dice?.count ?? 3,
    sides: dice?.sides ?? 6,
    look: diceLook(game.players[by], defender ? "#d9584e" : "#7fb0df"),
    defender,
  };
}

/** Press, hold and let go, for a roll: `down` and `up` from a button, the tray, or Space. */
export function useHoldToShake(on: boolean, intent: Intent, as: PlayerId | undefined, roll: () => void) {
  const [holding, setHolding] = useState(false);
  const pressed = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ intent, as, roll });
  useEffect(() => {
    live.current = { intent, as, roll };
  });

  const down = () => {
    if (pressed.current) return;
    pressed.current = setTimeout(() => {
      const h = handFor(live.current.intent, live.current.as);
      trayHand.take(h.count, h.sides, h.look, h.defender, t("Shaking… let go to roll"));
      setHolding(true);
    }, TAP_MS);
  };
  const up = () => {
    if (!pressed.current) return;
    clearTimeout(pressed.current);
    pressed.current = null;
    if (holding) whoosh();
    setHolding(false);
    trayHand.letGo();
    live.current.roll();
  };
  const cancel = () => {
    if (pressed.current) clearTimeout(pressed.current);
    pressed.current = null;
    if (holding) trayHand.drop();
    setHolding(false);
  };

  // While held: the rattle and the jostle, faster as the shake builds, and after a while a word to let go.
  useEffect(() => {
    if (!holding) return;
    sendShaking(true);
    let timer: ReturnType<typeof setTimeout>;
    const began = performance.now();
    const tick = () => {
      const held = performance.now() - began;
      const built = Math.min(1, held / BUILD_MS);
      rattle();
      if (typeof navigator !== "undefined") navigator.vibrate?.(6);
      trayHand.shake(0.35 + 0.65 * built, held > HINT_MS ? t("Let go to roll") : undefined);
      timer = setTimeout(tick, 230 - 140 * built);
    };
    tick();
    // Let go, or gone: the table stops hearing it.
    return () => {
      clearTimeout(timer);
      sendShaking(false);
    };
  }, [holding]);
  useEffect(
    () => () => {
      if (pressed.current) clearTimeout(pressed.current);
    },
    [],
  );

  const handlers = on
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          down();
        },
        onPointerUp: up,
        onPointerCancel: cancel,
        // Enter rolls at once; Space can be held like the mouse.
        onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
          if (e.key === " ") {
            e.preventDefault();
            if (!e.repeat) down();
          } else if (e.key === "Enter") {
            e.preventDefault();
            trayHand.letGo();
            live.current.roll();
          }
        },
        onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => {
          if (e.key !== " ") return;
          e.preventDefault();
          up();
        },
        onBlur: cancel,
      }
    : { onClick: roll };
  return { handlers, down, up, cancel };
}

/**
 * Your dice waiting in the tray for the roll in front of you (an attack's next
 * step, your saves): press and hold the tray, or Space, to shake; let go to
 * throw. The defender gets the same tray for their saves on their own device.
 */
export function WaitingDice({ intent, as, roll }: { intent: Intent; as?: PlayerId; roll: () => void }) {
  const hold = useHoldToShake(true, intent, as, roll);
  const key = JSON.stringify(intent) + (as ?? "");
  const stage = useStore((s) => `${s.game.attack?.stage ?? ""}:${s.record.events.at(-1)?.seq ?? 0}`);
  const live = useRef(hold);
  useEffect(() => {
    live.current = hold;
  });
  // Into the tray once it's free (a roll before this one may still be landing).
  useEffect(() => {
    let placed = false;
    const put = () => {
      if (placed || !trayHand.free()) return;
      const h = handFor(intent, as);
      trayHand.take(h.count, h.sides, h.look, h.defender, t("Hold to shake, let go to roll · Space"));
      placed = true;
    };
    put();
    const timer = setInterval(put, 250);
    trayHand.hold = { down: () => live.current.down(), up: () => live.current.up() };
    return () => {
      clearInterval(timer);
      trayHand.hold = null;
    };
    // `key` and `stage` say when it's a new roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stage]);
  useEffect(() => () => trayHand.drop(), []);
  // Space anywhere but a field or a button: the waiting roll.
  useEffect(() => {
    const busy = (e: KeyboardEvent) =>
      e.key !== " " ||
      // Space mid-drag turns a corner (move legs).
      tableDrag.active ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, [contenteditable]");
    const keyDown = (e: KeyboardEvent) => {
      if (busy(e)) return;
      e.preventDefault();
      if (!e.repeat) live.current.down();
    };
    const keyUp = (e: KeyboardEvent) => {
      if (busy(e)) return;
      e.preventDefault();
      live.current.up();
    };
    addEventListener("keydown", keyDown);
    addEventListener("keyup", keyUp);
    return () => {
      removeEventListener("keydown", keyDown);
      removeEventListener("keyup", keyUp);
    };
  }, []);
  return null;
}

/** Shaking this long with no word is a lost "let go": it stops showing. */
const SHAKE_STALE_MS = 12000;

/**
 * Another player shaking their dice (talk/shake): "Ana is shaking…" where
 * the dice will land, and their rattle, quieter than your own.
 */
export function OthersShaking() {
  const shaking = useTalk((s) => s.shaking);
  const players = useStore((s) => s.game.players);
  const self = useStore((s) => s.session?.selfId);
  const [now, setNow] = useState(() => Date.now());
  const who = Object.entries(shaking).filter(([id, at]) => id !== self && now - at < SHAKE_STALE_MS);
  const any = who.length > 0;
  useEffect(() => {
    if (!any) return;
    const timer = setInterval(() => {
      rattle(0.5);
      setNow(Date.now());
    }, 260);
    return () => clearInterval(timer);
  }, [any]);
  if (!any) return null;
  return (
    <div className="others-shaking" role="status">
      {who.map(([id]) => (
        <span key={id} style={{ color: players[id]?.color }}>
          {t("{name} is shaking…", { name: players[id]?.name ?? "" })}
        </span>
      ))}
    </div>
  );
}
