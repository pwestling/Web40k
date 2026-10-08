import { useEffect, useRef, useState } from "react";
import { delaying } from "../broadcast/broadcast";
import { useReel } from "../broadcast/reel";
import { modelHeight, sideName, sidePlayers, sides, type GameState } from "../core";
import { useShowcase, type Shot } from "../render/showcase";
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
/** About 12 degrees above the table. */
const LOW = Math.tan((12 * Math.PI) / 180);

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
      title: army ?? `${sideName(game, seat)}'s army`,
      line: [points ? `${points} pts` : "", sideName(game, seat)].filter(Boolean).join(" · "),
      color: players[0]?.color ?? "#e5e7eb",
    };
    return [{ card, minX: Math.min(...xs), maxX: Math.max(...xs), y, height }];
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
  const token = useRef(0);
  // Name plates as they were, to put back afterwards.
  const plates = useRef<boolean | null>(null);

  const stop = () => {
    token.current++;
    setCard(null);
    setRound(false);
    if (!useShowcase.getState().on) return;
    useShowcase.setState({ on: false, shot: null });
    document.body.classList.remove("showcase");
    if (plates.current !== null) useStore.getState().set({ plates: plates.current });
    plates.current = null;
  };

  useEffect(() => {
    const was = last.current;
    last.current = turn.round;
    // The battle starting on this screen: live, behind the delay, or a replay playing through it.
    if (was !== 0 || turn.round < 1 || played.has(initial) || useReel.getState().index !== null) return;
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
    plates.current = s.plates;
    s.set({ plates: false });
    s.select(null);

    let at = 0;
    for (const side of sidesNow) {
      const dur = moving ? ARMY_MS : STILL_MS;
      later(at, () => {
        drum();
        setCard(side.card);
        if (!moving) return;
        // Low, in front of the army, dollying along it.
        const toward = side.y > 0 ? -1 : 1;
        const h = Math.min(6, side.height * 3);
        // Kept on the near side of the table's middle, so the other army stays behind the camera's back.
        const back = Math.min(h / LOW, Math.abs(side.y) + depth * 0.1);
        const z = side.y + toward * back;
        const pad = Math.min(4, (side.maxX - side.minX) / 4);
        const [x0, x1] = toward < 0 ? [side.minX + pad, side.maxX - pad] : [side.maxX - pad, side.minX + pad];
        const shot: Shot = {
          from: [x0, h, z],
          to: [x1, h, z],
          lookFrom: [x0, side.height * 0.6, side.y],
          lookTo: [x1, side.height * 0.6, side.y],
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
    at += WIDE_MS;
    later(at, () => {
      setRound(true);
      horn();
    });
    later(at + ROUND_MS, stop);
  }, [turn.round, scrub, initial]);

  // Anyone can skip it: a click or Esc, on this screen only.
  const on = card !== null || round;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && stop();
    addEventListener("keydown", key);
    addEventListener("pointerdown", stop, { capture: true });
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", stop, { capture: true });
    };
  }, [on]);

  useEffect(() => stop, []);

  if (round)
    return (
      <div className="showcase-round" role="status">
        Round 1
      </div>
    );
  if (!card) return null;
  return (
    <div className="showcase-card" style={{ borderColor: card.color }} role="status" key={card.title}>
      <div className="title" style={{ color: card.color }}>
        {card.title}
      </div>
      <div className="line">{card.line}</div>
    </div>
  );
}
