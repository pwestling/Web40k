import { useEffect, useRef } from "react";
import { noteReason } from "./reasons";
import { useHold } from "../ui/hold";
import { sidePlayers, type GameState, type Unit } from "../core";
import { clearDrawings, hear } from "../talk/talk";
import { t } from "../i18n";
import { explain } from "./explain";
import { pendingScores } from "../missions/scoring";
import { sandboxBotMove } from "../sandbox/runtime";
import { legal, type BotMove } from "../soak/bot";
import { useStore } from "../store";
import { waitsOn } from "../teach/coach";
import { missionOf } from "../ui/Missions";
import { botPolicy } from "./player";
import { characterName, GLIDE_MS, levelName, useSolo } from "./solo";
import { canThinkOffThread, sawOffThread, thinkOffThread } from "./think";

/** How long the computer waits before each move, and on each roll so the player can follow it. */
const BOT_PACE = 500;
const ROLL_PACE = 1100;
/** After the dice tray lands a roll: time to read the result before the computer moves on (PX solo 2, A). */
const AFTER_DICE = 900;

/**
 * Solo against the computer (#45): plays the computer's side one move at a
 * time, paced so the player can follow. In a package game its moves are
 * worked out in the package sandbox, where the game's code is. It confirms
 * its own side's scores as the mission suggests them. Mounted in the game
 * screen (the side panel says who plays which side).
 */
export function SoloBot() {
  const level = useSolo((s) => s.level);
  const mine = useSolo((s) => s.session);
  const paused = useSolo((s) => s.paused);
  const session = useStore((s) => s.session);
  const game = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  const timer = useRef<number | null>(null);
  // The dice tray still showing a roll: the computer waits for it to land (PX solo 2, A).
  const tray = useHold((s) => s.held !== null || s.busy);
  const wasTray = useRef(false);
  const on = !!level && !paused && mine === session && !!session;

  useEffect(() => {
    if (tray) {
      wasTray.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      return;
    }
    if (!on || scrub !== null || timer.current !== null) return;
    const rolling = !!(game.attack || game.procedure || game.script?.waiting);
    const landed = wasTray.current;
    wasTray.current = false;
    timer.current = window.setTimeout(
      () => {
        timer.current = null;
        void play();
      },
      landed ? AFTER_DICE : rolling ? ROLL_PACE : glided(game) ? GLIDE_MS + BOT_PACE : BOT_PACE,
    );
  }, [on, game, scrub, tray]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return null;
}

/** Whether the newest event is the computer's own move, still gliding into place. */
function glided(game: GameState): boolean {
  const last = useStore.getState().record.events.at(-1);
  const seat = useSolo.getState().seat;
  return !!last && last.event.type === "models/move" && game.players[last.by ?? ""]?.seat === seat;
}

/** The computer's next move, if it has one, sent as its player. */
async function play(): Promise<void> {
  const solo = useSolo.getState();
  const { record, game, dispatch, scrub, session } = useStore.getState();
  const hold = useHold.getState();
  if (hold.held !== null || hold.busy) return;
  if (!solo.level || solo.paused || solo.session !== session || scrub !== null || game.turn.round === 0)
    return;
  const player = sidePlayers(game, solo.seat)[0]?.id;
  if (!player) return;
  // The sides by who plays them (UX 349, PX 4): "You" and "The Warden of Ash (Steady)".
  for (const p of Object.values(game.players)) {
    if (p.seat === undefined) continue;
    const name =
      p.seat === solo.seat
        ? t("{name} ({level})", { name: characterName(solo.level), level: levelName(solo.level) })
        : t("You");
    if (p.name !== name) {
      dispatch({ type: "player/rename", player: p.id, name }, p.id);
      return;
    }
  }
  // Its own side's scores, as the mission suggests them.
  const due = pendingScores(record, game, missionOf(game)).find((p) => p.seat === solo.seat && !p.ask);
  if (due) {
    dispatch(
      { type: "score/confirm", key: due.key, seat: due.seat, round: due.round, vp: due.vp, why: due.why },
      player,
    );
    return;
  }
  let move: BotMove | null;
  // Each decision shows as "bot:think" in the browser's performance timeline (scripts/bot.mjs reads them).
  const thinking = performance.now();
  // A package game thinks in its sandbox, where the game's code is; a built-in one in its own worker,
  // so the table keeps drawing (a Sharp decision takes up to a second on a phone).
  const remote = sandboxBotMove(solo.level, solo.seat, player, solo.seed);
  const worker = remote ? null : thinkOffThread(solo.level, solo.seat, player, solo.seed);
  if (remote || worker) {
    let failed = false;
    move = (await (remote ?? worker)!.catch(() => ((failed = true), null))) as BotMove | null;
    // The game moved on while it thought: the next change asks again.
    if (useStore.getState().record !== record || useSolo.getState().paused) return;
    // Its worker didn't start: think on the page from now on.
    if (failed && worker && !canThinkOffThread()) return void window.setTimeout(() => void play(), BOT_PACE);
  } else {
    const policy = solo.policy ?? botPolicy(solo.level, game, solo.seat, { seed: solo.seed });
    if (!solo.policy) useSolo.setState({ policy });
    move = policy.move(record, game, { seat: solo.seat, player });
  }
  performance.measure("bot:think", { start: thinking, detail: { remote: !!remote, worker: !!worker } });
  // A package game's moves were checked in its sandbox, which has the game's code; this side hasn't.
  if (!move || (!remote && !legal(record, game, move))) {
    // Nothing the rules allow just yet (a roll settling): look again shortly.
    if (waitsOn(game, solo.seat)) window.setTimeout(() => void play(), BOT_PACE);
    return;
  }
  const why = tell(game, move, player);
  // The log line for its move says why (PX solo review B), once the move lands (a package game's
  // moves are worked out in its sandbox, so they arrive a moment later).
  if (why) awaitMove(move.as, record.events.at(-1)?.seq ?? 0, why);
  dispatch(move.intent, move.as);
  if (move.then) {
    const after = useStore.getState();
    if (remote || legal(after.record, after.game, move.then)) dispatch(move.then.intent, move.then.as);
  }
  if (worker) sawOffThread(move);
  useSolo.getState().policy?.saw?.(useStore.getState().game, move);
}

/** Reasons waiting for the computer's move to land in the record. */
let waiting: { by: string; after: number; text: string } | null = null;

function awaitMove(by: string, after: number, text: string): void {
  waiting = { by, after, text };
  look();
}

function look(): void {
  if (!waiting) return;
  const w = waiting;
  const e = useStore
    .getState()
    .record.events.find((x) => x.seq > w.after && x.by === w.by && x.event.type === "models/move");
  if (!e) return;
  noteReason(e, w.text);
  waiting = null;
}

useStore.subscribe((s, prev) => {
  if (waiting && s.record !== prev.record) look();
});

/** The unit whose go the table was last shown. */
let shown: string | null = null;

/**
 * Show a computer move on the table (PX 2-3, UX 348): a ring on the unit
 * when its go starts (your own unit card closes), a line from where it was
 * to where it went, and why, in one line in the chat. Table talk, so none of
 * it goes in the game's log.
 */
function tell(game: GameState, move: BotMove, player: string): string | null {
  const why = explain(game, move);
  if (!why) return null;
  const unit = game.units[why.unitId];
  if (!unit) return null;
  const now = Date.now();
  const id = (k: string) => `bot${now.toString(36)}${k}`;
  if (shown !== why.unitId) {
    shown = why.unitId;
    clearDrawings(player);
    useStore.getState().select(null);
    const at = why.from ?? centreOf(game, unit);
    // A ring on the spot, with no "pinged" toast (PX solo 2, B).
    if (at) hear({ id: id("p"), kind: "ping", at }, player, now);
  }
  if (why.from && why.to) hear({ id: id("a"), kind: "arrow", from: why.from, to: why.to }, player, now);
  // Its reason goes in the hint, in place, not in the chat (UX 352).
  useSolo.setState({ why: `${unit.name}: ${why.text}` });
  // Attacks name their target in the log already; moves say where they're headed.
  return why.from && why.to ? why.text : null;
}

function centreOf(game: GameState, unit: Unit): { x: number; y: number } | null {
  const ms = unit.modelIds.flatMap((m) =>
    game.models[m] && !game.models[m]!.destroyed ? [game.models[m]!] : [],
  );
  if (!ms.length) return null;
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
    y: ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
  };
}
