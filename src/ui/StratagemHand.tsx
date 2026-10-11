import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameState, Player, PlayerId, UnitId } from "../core";
import { armyStratagem, findAction, playerActions, type PlayerActionOption } from "../core/content/player";
import { schedule, systemOf } from "../core/content/turn";
import { gameText, t } from "../i18n";
import { displayName } from "../i18n/names";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { narrow } from "./narrow";
import { coin, flip, pick, thunk, useSound } from "./sound";
import { tablePick, useHandTargets } from "./tablePick";
import { focusOn } from "../render/focus";

/**
 * Stratagems as a hand of cards (UX 499, PX stratagem-hand.md): a low fan
 * along the bottom edge, the ones you can play now standing up. Drag a card
 * onto a unit (or onto the table, for one with no unit) to play it; or click
 * a card, then a unit. The engine still decides: a card it wouldn't take
 * springs back with the reason. Other players' cards turn up face down and
 * flip over. The stratagem panel stays as the long way round.
 */

/** Cards shown before the rest go in a "+N" stack. */
const FAN = 6;
/** How far the pointer moves before a press on a card becomes a drag. */
const SLOP = 6;

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Whose hand shows: yours, or in hotseat the side whose turn it is (the other
 * side's reactions stay in the stratagem panel, so a hand never changes owner
 * under the player's fingers).
 */
function handPlayer(game: GameState, canControl: (id: PlayerId) => boolean): Player | null {
  const mine = Object.values(game.players)
    .filter((p) => p.seat !== undefined && canControl(p.id))
    .sort((a, b) => Number(b.seat === game.turn.activeSeat) - Number(a.seat === game.turn.activeSeat));
  return mine[0] ?? null;
}

/** The hand shows: a live battle in a system with stratagems, for a player at the table. */
export function useHandShown(): boolean {
  const game = useGame();
  const role = useStore((s) => s.role);
  const scrub = useStore((s) => s.scrub);
  const canControl = useCanControl();
  if (role === "spectator" || scrub !== null || game.turn.round === 0 || game.settings.companion)
    return false;
  if (!systemOf(game).actions.some((a) => a.by === "player" && !a.custom)) return false;
  return handPlayer(game, canControl) !== null;
}

type Held = { option: PlayerActionOption; x: number; y: number; ox: number; oy: number; moved: boolean };
type Over = { unitId: UnitId | null; ok: boolean; line: string };

function unitName(game: GameState, id: UnitId): string {
  return displayName(game.units[id]?.name ?? "");
}

/** What letting go here would do. */
function overAt(game: GameState, option: PlayerActionOption, x: number, y: number): Over {
  const name = gameText(option.def.name);
  const unitId = tablePick.unitAt(x, y);
  if (option.targets) {
    if (!unitId) return { unitId, ok: false, line: t("Drop it on a unit") };
    const unit = unitName(game, unitId);
    if (!option.targets.includes(unitId))
      return { unitId, ok: false, line: t("{name} can't go on {unit}", { name, unit }) };
    if (!option.ok) return { unitId, ok: false, line: gameText(option.why ?? "") };
    return { unitId, ok: true, line: t("Play on {unit} · {cost}", { unit, cost: option.cost }) };
  }
  if (!tablePick.onTable(x, y)) return { unitId: null, ok: false, line: t("Drop it on the table") };
  if (!option.ok) return { unitId: null, ok: false, line: gameText(option.why ?? "") };
  return { unitId: null, ok: true, line: t("Play {name} · {cost}", { name, cost: option.cost }) };
}

/**
 * A card with nothing of its own to do (no unit, no effect: a re-roll) waits for
 * the roll that needs it. It sits down with the rest, so the fan can fold, but
 * it can still be played (PX feel pass).
 */
const standby = (o: PlayerActionOption) =>
  o.ok && !o.def.target && !o.def.do?.length && !o.def.procedure && !o.def.move && !o.def.endsTurn;
const playable = (o: PlayerActionOption) => o.ok && !standby(o);
const whyDown = (o: PlayerActionOption) =>
  standby(o) ? t("Play it when a roll calls for it") : gameText(o.why ?? "");

/** When, Target and Effect for the raised card: a faction stratagem's own words, else from the rules data. */
function cardText(game: GameState, o: PlayerActionOption): [string, string][] {
  const army = armyStratagem(game, o.def.id);
  const slots = schedule(systemOf(game));
  const phases = [
    ...new Set((o.def.phases ?? []).map((id) => gameText(slots.find((s) => s.id === id)?.name ?? id))),
  ].join(", ");
  const side = {
    active: t("Your turn"),
    inactive: t("Your opponent's turn"),
    either: t("Either player's turn"),
  }[o.def.side ?? "either"];
  const when = army?.when ?? (phases ? `${side}: ${phases}` : side);
  const target = army?.target ?? (o.def.target ? t("One of your units") : undefined);
  const effect = army?.effect ?? army?.text ?? (o.def.hint ? gameText(o.def.hint) : undefined);
  return [
    [t("When"), when],
    ...(target ? [[t("Target"), target] as [string, string]] : []),
    ...(effect ? [[t("Effect"), effect] as [string, string]] : []),
  ];
}

export function StratagemHand() {
  const game = useGame();
  const dispatch = useStore((s) => s.dispatch);
  const canControl = useCanControl();
  const shown = useHandShown();
  const fast = useSound((s) => s.fast);
  const player = shown ? handPlayer(game, canControl) : null;
  // The ones playable now first, so they're never in the stack.
  const options = player
    ? playerActions(game, player.id)
        .filter((o) => !o.def.custom)
        .sort((a, b) => Number(playable(b)) - Number(playable(a)) || Number(b.ok) - Number(a.ok))
    : [];
  const ready = options.filter(playable).length;
  const [peek, setPeek] = useState(false);
  const [spread, setSpread] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [back, setBack] = useState<{ id: string; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [step, setStep] = useState<UnitId | null>(null);
  const hand = useRef<HTMLDivElement>(null);
  const live = useRef({ game, player, options });
  useEffect(() => {
    live.current = { game, player, options };
  });
  const choice = options.find((o) => o.def.id === picked) ?? null;

  const play = (option: PlayerActionOption, targetId?: UnitId) => {
    const who = live.current.player;
    if (!who) return;
    dispatch({ type: "player/action", action: option.def.id, ...(targetId ? { targetId } : {}) }, who.id);
    coin();
    thunk(1);
    setPicked(null);
  };
  const tell = (line: string) => {
    setNote(line);
    setTimeout(() => setNote((n) => (n === line ? null : n)), fast ? 1500 : 2800);
  };

  // A card held: follow the pointer, light its units, and play it or spring it back on letting go.
  const heldId = held?.option.def.id;
  useEffect(() => {
    if (!heldId) return;
    const move = (e: PointerEvent) => {
      setHeld((h) => {
        if (!h) return h;
        const moved = h.moved || Math.hypot(e.clientX - h.ox, e.clientY - h.oy) > SLOP;
        if (moved && !h.moved) {
          pick();
          useHandTargets.setState({ ids: h.option.targets ?? null, color: live.current.player?.color });
        }
        if (moved) setOver(overAt(live.current.game, h.option, e.clientX, e.clientY));
        return { ...h, x: e.clientX, y: e.clientY, moved };
      });
    };
    const up = (e: PointerEvent) => {
      setHeld((h) => {
        if (h?.moved) {
          const at = overAt(live.current.game, h.option, e.clientX, e.clientY);
          if (at.ok) play(h.option, at.unitId ?? undefined);
          else {
            setBack({ id: h.option.def.id, x: e.clientX - h.ox, y: e.clientY - h.oy });
            if (at.line) tell(at.line);
          }
        }
        return null;
      });
      setOver(null);
      useHandTargets.setState({ ids: null });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHeld(null);
      setOver(null);
      useHandTargets.setState({ ids: null });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      removeEventListener("keydown", key);
    };
    // play and tell read the latest state through `live` and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldId]);

  // A spring back settles on the next frame.
  useEffect(() => {
    if (!back) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBack(null)));
    return () => cancelAnimationFrame(id);
  }, [back]);

  // A card picked by a click: the next click on one of its units plays it; Esc puts it back.
  useEffect(() => {
    if (!choice) {
      useHandTargets.setState({ ids: null });
      return;
    }
    useHandTargets.setState({ ids: choice.targets ?? null, color: live.current.player?.color });
    // [ and ] step through the units it can go on, Enter plays it there (spec §4).
    let at = -1;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setPicked(null);
      const ids = choice.targets;
      if (!ids?.length || (e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        e.stopImmediatePropagation();
        at = (at + (e.key === "]" ? 1 : -1) + ids.length) % ids.length;
        const unit = live.current.game.units[ids[at]!];
        useStore.getState().set({ hoverUnit: ids[at]! });
        const models = unit ? unit.modelIds.flatMap((m) => live.current.game.models[m] ?? []) : [];
        if (models.length)
          focusOn(
            models.reduce((n, m) => n + m.position.x, 0) / models.length,
            models.reduce((n, m) => n + m.position.y, 0) / models.length,
          );
        setStep(ids[at]!);
      } else if (e.key === "Enter" && at >= 0 && choice.ok) {
        e.preventDefault();
        e.stopImmediatePropagation();
        play(choice, ids[at]!);
      }
    };
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement) || !choice.targets) return;
      const unitId = tablePick.unitAt(e.clientX, e.clientY);
      if (!unitId) return;
      // Not the selection, nor a drag: the click is the card's.
      e.stopPropagation();
      e.preventDefault();
      if (choice.targets.includes(unitId) && choice.ok) play(choice, unitId);
      else tell(overAt(live.current.game, choice, e.clientX, e.clientY).line);
    };
    addEventListener("keydown", key, { capture: true });
    addEventListener("pointerdown", down, { capture: true });
    return () => {
      removeEventListener("keydown", key, { capture: true });
      removeEventListener("pointerdown", down, { capture: true });
      useHandTargets.setState({ ids: null });
      setStep(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice?.def.id, choice?.ok, choice?.targets?.join()]);

  // The replay handle steps aside for the fan.
  useEffect(() => {
    document.body.classList.toggle("has-hand", shown);
    return () => document.body.classList.remove("has-hand");
  }, [shown]);

  // S picks up the hand from the keyboard (spec §4).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "s" && e.key !== "S") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const first = hand.current?.querySelector<HTMLButtonElement>(".hand-card");
      if (!first) return;
      e.preventDefault();
      setPeek(true);
      requestAnimationFrame(() => hand.current?.querySelector<HTMLButtonElement>(".hand-card")?.focus());
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  if (!player) return <Reveals />;
  const cp = game.resources[player.id]?.CP;
  const folded = !held && !picked && !peek && (ready === 0 || narrow());
  const visible = spread || options.length <= FAN ? options : options.slice(0, FAN - 1);
  const stacked = options.length - visible.length;
  const speed = { "--hand-speed": fast ? 0.5 : 1 } as CSSProperties;

  return (
    <>
      <div
        ref={hand}
        className={`stratagem-hand ${folded ? "folded" : ""} ${held?.moved ? "holding" : ""}`}
        style={{ ...speed, "--side": player.color } as CSSProperties}
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => {
          setPeek(false);
          setSpread(false);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPeek(false);
        }}
      >
        {cp !== undefined && (
          <span className="cp-pips" title={t("{cp} CP", { cp })} aria-label={t("{cp} CP", { cp })}>
            {Array.from({ length: Math.min(cp, 8) }, (_, i) => (
              <i key={i} className="pip" />
            ))}
            <span className="muted">{t("{cp} CP", { cp })}</span>
          </span>
        )}
        {folded ? (
          <button className="hand-strip" onClick={() => setPeek(true)} aria-expanded={false}>
            {ready ? t("Stratagems · {n} ready", { n: ready }) : t("Stratagems · {n}", { n: options.length })}
          </button>
        ) : (
          <div className="fan" role="group" aria-label={t("Stratagems")}>
            {visible.map((o, i) => {
              const id = o.def.id;
              const lifted = held?.moved && heldId === id;
              const style = {
                "--i": i - (visible.length - 1) / 2,
                ...(lifted ? { visibility: "hidden" } : {}),
                ...(back?.id === id
                  ? { transform: `translate(${back.x}px, ${back.y}px)`, transition: "none" }
                  : {}),
              } as CSSProperties;
              return (
                <button
                  key={id}
                  className={`hand-card ${playable(o) ? "ready" : "down"} ${o.why?.startsWith("Already used") ? "used" : ""} ${picked === id ? "picked" : ""}`}
                  style={style}
                  aria-label={`${gameText(o.def.name)}, ${o.cost}${playable(o) ? "" : `: ${whyDown(o)}`}`}
                  aria-pressed={picked === id}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    setPicked(null);
                    setHeld({
                      option: o,
                      x: e.clientX,
                      y: e.clientY,
                      ox: e.clientX,
                      oy: e.clientY,
                      moved: false,
                    });
                  }}
                  onClick={() => {
                    if (held?.moved) return;
                    if (!o.ok) {
                      tell(`${gameText(o.def.name)}: ${gameText(o.why ?? "")}`);
                      return;
                    }
                    setPicked(picked === id ? null : id);
                  }}
                  onKeyDown={(e) => {
                    const cards = [
                      ...(hand.current?.querySelectorAll<HTMLButtonElement>(".hand-card") ?? []),
                    ];
                    const at = cards.indexOf(e.currentTarget);
                    if (e.key === "ArrowRight") cards[(at + 1) % cards.length]?.focus();
                    else if (e.key === "ArrowLeft") cards[(at - 1 + cards.length) % cards.length]?.focus();
                  }}
                >
                  <span className="cost">{o.cost}</span>
                  <strong className="name">{gameText(o.def.name)}</strong>
                  {o.def.hint && <span className="hint">{gameText(o.def.hint)}</span>}
                  {!playable(o) && <span className="why">{whyDown(o)}</span>}
                  {/* Raised: the whole card, When, Target and Effect. */}
                  <dl className="full">
                    {cardText(game, o).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {o.why?.startsWith("Already used") && <span className="clip">{t("used")}</span>}
                </button>
              );
            })}
            {stacked > 0 && (
              <button
                className="hand-stack"
                onClick={() => setSpread(true)}
                onMouseEnter={() => setSpread(true)}
              >
                +{stacked}
              </button>
            )}
          </div>
        )}
        {choice && (
          <div className="hand-ask" role="status">
            {choice.targets ? (
              <>
                <span>
                  {t("Pick a unit for {name}, or [ ] then Enter (Esc to cancel)", {
                    name: gameText(choice.def.name),
                  })}
                </span>
                {choice.targets.map((u) => (
                  <button
                    key={u}
                    className={`small ${step === u ? "on" : ""}`}
                    onClick={() => play(choice, u)}
                  >
                    {unitName(game, u)}
                  </button>
                ))}
              </>
            ) : (
              <button className="small primary" onClick={() => play(choice)}>
                {t("Play {name} · {cost}", { name: gameText(choice.def.name), cost: choice.cost })}
              </button>
            )}
            <button className="small quiet" onClick={() => setPicked(null)}>
              {t("Cancel")}
            </button>
          </div>
        )}
        {note && (
          <div className="hand-note" role="status">
            {note}
          </div>
        )}
      </div>
      {held?.moved && (
        <div
          className={`hand-ghost ${over?.ok ? "over" : ""}`}
          style={{ left: held.x, top: held.y, ...speed, "--side": player.color } as CSSProperties}
          aria-hidden
        >
          <div className="hand-card ready">
            <span className="cost">{held.option.cost}</span>
            <strong className="name">{gameText(held.option.def.name)}</strong>
          </div>
          {over?.line && <span className={`hand-tag ${over.ok ? "ok" : ""}`}>{over.line}</span>}
        </div>
      )}
      <Reveals />
    </>
  );
}

type Reveal = {
  seq: number;
  name: string;
  who: string;
  color: string;
  unit: string;
  cost: string;
  mine: boolean;
  /** Played on a unit in view: it lands there, on screen. */
  at: { x: number; y: number } | null;
};

/**
 * A card played by someone else turns up face down from the far edge and
 * flips over (spec §2, "the reveal"); your own lands briefly in place.
 */
function Reveals() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const canControl = useCanControl();
  const fast = useSound((s) => s.fast);
  const [shown, setShown] = useState<Reveal[]>([]);
  const last = useRef<number | null>(null);
  const top = record.events.at(-1)?.seq ?? 0;
  useEffect(() => {
    // What was already played when the table opened isn't news.
    if (last.current === null || scrub !== null) {
      last.current = top;
      return;
    }
    const fresh = record.events.filter((e) => e.seq > last.current! && e.event.type === "player/action");
    last.current = top;
    if (!fresh.length) return;
    const game = useStore.getState().game;
    const items = fresh.flatMap(({ seq, event }): Reveal[] => {
      if (event.type !== "player/action") return [];
      const def = findAction(game, event.action);
      const p = game.players[event.player];
      const spent = event.payment.reduce((n, x) => n + (x.amount ?? x.indices?.length ?? 0), 0);
      return [
        {
          seq,
          name: event.label ?? gameText(def?.name ?? event.action),
          who: displayName(p?.name ?? ""),
          color: p?.color ?? "#999",
          unit: event.targetId ? displayName(game.units[event.targetId]?.name ?? "") : "",
          cost: spent ? t("{n} CP", { n: spent }) : "",
          mine: canControl(event.player),
          at: event.targetId ? tablePick.screenOf(event.targetId) : null,
        },
      ];
    });
    if (items.some((r) => !r.mine)) setTimeout(flip, (fast ? 125 : 250) * (reduced() ? 0 : 1));
    setShown((s) => [...s, ...items].slice(-3));
    const gone = items.map((r) => r.seq);
    setTimeout(() => setShown((s) => s.filter((r) => !gone.includes(r.seq))), fast ? 1800 : 3200);
    // canControl and fast are read as they are when a card arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, scrub]);
  if (!shown.length) return null;
  const card = (r: Reveal) => (
    <div
      key={r.seq}
      className={`hand-reveal ${r.mine ? "mine" : "theirs"} ${r.at ? "at-unit" : ""}`}
      style={
        {
          "--side": r.color,
          ...(r.at
            ? { left: Math.max(84, Math.min(innerWidth - 84, r.at.x)), top: Math.max(8, r.at.y - 150) }
            : {}),
        } as CSSProperties
      }
    >
      <div className="face">
        <span className="cost">{r.cost}</span>
        <strong className="name">{r.name}</strong>
        <span className="small">{r.unit ? t("{who} on {unit}", { who: r.who, unit: r.unit }) : r.who}</span>
      </div>
      <div className="back" />
    </div>
  );
  const speed = { "--hand-speed": fast ? 0.5 : 1 } as CSSProperties;
  return (
    <div style={speed} aria-hidden>
      <div className="hand-reveals">{shown.filter((r) => !r.at).map(card)}</div>
      {shown.filter((r) => r.at).map(card)}
    </div>
  );
}
