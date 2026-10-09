import { useEffect, useRef, useState } from "react";
import { delaying } from "../broadcast/broadcast";
import { useReel } from "../broadcast/reel";
import { modelHeight, sideName, sidePlayers, sides, type GameState } from "../core";
import { owed, quiet, useShowcase, type Shot } from "../render/showcase";
import { touch } from "./touch";
import { t } from "../i18n";
import { useStore } from "../store";
import { useGame } from "./hooks";
import { drum, horn } from "./sound";

/**
 * The army showcase (PX-5a): when the battle starts, the camera goes low along
 * each army in turn under a title card, then high over the whole table, and
 * "Round 1" stamps in. About ten seconds, once per game, on every screen;
 * anyone can skip it with a click or Esc, and it never holds up anyone's input.
 * Reduced motion (or the top-down view): the cards over a still view.
 */

const ARMY_MS = 4000;
const STILL_MS = 2500;
const WIDE_MS = 2200;
const ROUND_MS = 1600;
/** How far in front of an army the camera runs, in inches. */
const BACK = 8;

interface Card {
  title: string;
  line: string;
  color: string;
}

/** Each side's army: name, points and players, and where its models stand. */
function armies(game: GameState) {
  return sides(game).flatMap((seat) => {
    const players = sidePlayers(game, seat);
    const ids = new Set(players.map((p) => p.id));
    const units = Object.values(game.units).filter((u) => ids.has(u.owner));
    const models = units.flatMap((u) => u.modelIds.flatMap((id) => game.models[id] ?? []));
    const standing = models.filter((m) => !m.destroyed);
    if (!standing.length) return [];
    const names = units.map((u) => u.army).filter((n): n is string => !!n);
    const army = names.sort(
      (a, b) => names.filter((n) => n === b).length - names.filter((n) => n === a).length,
    )[0];
    const points = units.reduce((a, u) => a + (u.sheet?.points ?? 0), 0);
    const xs = standing.map((m) => m.position.x);
    const y = standing.reduce((a, m) => a + m.position.y, 0) / standing.length;
    // A typical model's height (a tank would lift the camera off the line).
    const heights = standing.map((m) => modelHeight(m)).sort((p, q) => p - q);
    const height = Math.max(1, heights[Math.floor(heights.length / 2)] ?? 1);
    const card: Card = {
      title: army ?? t("{side}'s army", { side: sideName(game, seat) }),
      line: [points ? t("{points} pts", { points }) : "", sideName(game, seat)].filter(Boolean).join(" · "),
      color: players[0]?.color ?? "#e5e7eb",
    };
    // The rank nearest the middle of the table: the camera stands off from that.
    const ys = standing.map((m) => m.position.y);
    const front = y > 0 ? Math.min(...ys) : Math.max(...ys);
    return [{ card, minX: Math.min(...xs), maxX: Math.max(...xs), y, front, height }];
  });
}

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Showcases already played, by game (a new game or a branch gets its own). */
const played = new WeakSet<object>();

export function Showcase() {
  const turn = useGame().turn;
  const scrub = useStore((s) => s.scrub);
  const initial = useStore((s) => s.record.initial);
  const [card, setCard] = useState<Card | null>(null);
  const [round, setRound] = useState(false);
  const last = useRef<number | null>(null);
  const seen = useRef<object | null>(null);
  const token = useRef(0);
  // Name plates and x-ray as they were, to put back afterwards.
  const plates = useRef<{ plates: boolean; xray: boolean } | null>(null);

  const stop = () => {
    token.current++;
    setCard(null);
    setRound(false);
    if (!useShowcase.getState().on) return;
    useShowcase.setState({ on: false, shot: null });
    document.body.classList.remove("showcase");
    if (plates.current !== null) useStore.getState().set(plates.current);
    plates.current = null;
  };

  useEffect(() => {
    // Mounted just after the battle began (the one-click demo starts it before the table has loaded): as if from 0.
    // A game arriving whole (joining, or rejoining mid-game) isn't the battle starting here (UX 245).
    const arrived = seen.current !== initial;
    seen.current = initial;
    const was = (arrived ? null : last.current) ?? (owed.initial === initial && turn.round === 1 ? 0 : null);
    if (owed.initial === initial) owed.initial = null;
    last.current = turn.round;
    // The battle starting on this screen: live, behind the delay, or a replay playing through it.
    if (was !== 0 || turn.round < 1 || played.has(initial) || useReel.getState().index !== null) return;
    // Not for a review room: it goes over a game, it isn't one starting (UX 233).
    if (useStore.getState().review) return;
    // Nor for a workshop test table, restarted over and over (UX 311).
    if (quiet.initial === initial) return;
    if (scrub !== null && !delaying() && !useStore.getState().record.events.length) return;
    played.add(initial);
    const s = useStore.getState();
    const sidesNow = armies(s.game);
    if (!sidesNow.length) return;
    const my = ++token.current;
    const later = (ms: number, f: () => void) =>
      setTimeout(() => {
        if (my === token.current) f();
      }, ms);
    const moving = !reduced() && s.view === "3d";
    const { width, depth } = s.game.table;
    document.body.classList.add("showcase");
    useShowcase.setState({ on: true, shot: null });
    plates.current = { plates: s.plates, xray: s.xray };
    // Terrain between the camera and an army fades, so the models aren't behind a wall (PX-5 review).
    s.set({ plates: false, xray: true });
    s.select(null);

    let at = 0;
    for (const side of sidesNow) {
      const dur = moving ? ARMY_MS : STILL_MS;
      later(at, () => {
        drum();
        setCard(side.card);
        if (!moving) return;
        // Low, in front of the army, dollying along it: about 1.5 models high and 7" back, so they fill the lower third.
        const toward = side.y > 0 ? -1 : 1;
        const h = Math.max(1.2, Math.min(5, side.height * 1.5));
        // Kept on the near side of the table's middle, so the other army stays behind the camera's back.
        const back = Math.min(BACK, Math.abs(side.front) + depth * 0.1);
        const z = side.front + toward * back;
        const pad = Math.min(4, (side.maxX - side.minX) / 4);
        const [x0, x1] = toward < 0 ? [side.minX + pad, side.maxX - pad] : [side.maxX - pad, side.minX + pad];
        const shot: Shot = {
          from: [x0, h, z],
          to: [x1, h, z],
          lookFrom: [x0, side.height * 0.8, side.y],
          lookTo: [x1, side.height * 0.8, side.y],
          start: performance.now(),
          dur,
        };
        useShowcase.setState({ shot });
      });
      at += dur;
    }
    // The whole table, high, and "Round 1".
    later(at, () => {
      setCard(null);
      if (moving) {
        const span = Math.max(width, depth);
        const shot: Shot = {
          from: [0, span * 0.75, depth * 0.95],
          to: [0, span * 0.8, depth * 0.7],
          lookFrom: [0, 0, 0],
          lookTo: [0, 0, 0],
          start: performance.now(),
          dur: WIDE_MS + ROUND_MS,
        };
        useShowcase.setState({ shot });
      }
    });
    // Still cards have no wide shot to wait for.
    if (moving) at += WIDE_MS;
    later(at, () => {
      setRound(true);
      horn();
    });
    later(at + ROUND_MS, stop);
  }, [turn.round, scrub, initial]);

  // Anyone can skip it: a click or Esc, on this screen only; between cards too (a tap there did nothing, #60).
  const showing = useShowcase((s) => s.on);
  const on = card !== null || round || showing;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && stop();
    // The tap that skips does nothing else: it never reaches the table to select a unit (UX 164).
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const tap = (e: PointerEvent) => {
      swallow(e);
      for (const type of ["pointerup", "click"])
        addEventListener(type, swallow, { capture: true, once: true });
      // A tap with no click after it leaves nothing armed.
      setTimeout(() => {
        for (const type of ["pointerup", "click"]) removeEventListener(type, swallow, { capture: true });
      }, 600);
      stop();
    };
    addEventListener("keydown", key);
    addEventListener("pointerdown", tap, { capture: true });
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", tap, { capture: true });
    };
  }, [on]);

  // Unmounted mid-showcase (development's double mount does this): it's still owed when the table comes back.
  const shown = useRef(initial);
  useEffect(() => {
    shown.current = initial;
  }, [initial]);
  useEffect(
    () => () => {
      if (useShowcase.getState().on) {
        played.delete(shown.current);
        owed.initial = shown.current;
        last.current = null;
      }
      stop();
    },
    [],
  );

  if (round)
    return (
      <div className="showcase-round" role="status">
        {t("Round {round}", { round: 1 })}
      </div>
    );
  if (!card) return null;
  return (
    <div className="showcase-card" style={{ borderColor: card.color }} role="status" key={card.title}>
      <div className="title" style={{ color: card.color }}>
        {card.title}
      </div>
      <div className="line">{card.line}</div>
      <div className="skip">{touch() ? t("Tap to skip") : t("Click or Esc to skip")}</div>
    </div>
  );
}
