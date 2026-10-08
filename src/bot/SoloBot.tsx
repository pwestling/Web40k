import { useEffect, useRef } from "react";
import { sidePlayers } from "../core";
import { pendingScores } from "../missions/scoring";
import { sandboxBotMove } from "../sandbox/runtime";
import { legal, type BotMove } from "../soak/bot";
import { useStore } from "../store";
import { waitsOn } from "../teach/coach";
import { missionOf } from "../ui/Missions";
import { botPolicy } from "./player";
import { useSolo } from "./solo";

/** How long the computer waits before each move, and on each roll so the player can follow it. */
const BOT_PACE = 500;
const ROLL_PACE = 1100;

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
  const session = useStore((s) => s.session);
  const game = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  const timer = useRef<number | null>(null);
  const on = !!level && mine === session && !!session;

  useEffect(() => {
    if (!on || scrub !== null || timer.current !== null) return;
    const rolling = !!(game.attack || game.procedure || game.script?.waiting);
    timer.current = window.setTimeout(
      () => {
        timer.current = null;
        void play();
      },
      rolling ? ROLL_PACE : BOT_PACE,
    );
  }, [on, game, scrub]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return null;
}

/** The computer's next move, if it has one, sent as its player. */
async function play(): Promise<void> {
  const solo = useSolo.getState();
  const { record, game, dispatch, scrub, session } = useStore.getState();
  if (!solo.level || solo.session !== session || scrub !== null || game.turn.round === 0) return;
  const player = sidePlayers(game, solo.seat)[0]?.id;
  if (!player) return;
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
  const remote = sandboxBotMove(solo.level, solo.seat, player, solo.seed);
  if (remote) {
    move = (await remote.catch(() => null)) as BotMove | null;
    // The game moved on while the sandbox thought: the next change asks again.
    if (useStore.getState().record !== record) return;
  } else {
    const policy = solo.policy ?? botPolicy(solo.level, game, solo.seat, { seed: solo.seed });
    if (!solo.policy) useSolo.setState({ policy });
    move = policy.move(record, game, { seat: solo.seat, player });
  }
  // A package game's moves were checked in its sandbox, which has the game's code; this side hasn't.
  if (!move || (!remote && !legal(record, game, move))) {
    // Nothing the rules allow just yet (a roll settling): look again shortly.
    if (waitsOn(game, solo.seat)) window.setTimeout(() => void play(), BOT_PACE);
    return;
  }
  dispatch(move.intent, move.as);
  if (move.then) {
    const after = useStore.getState();
    if (remote || legal(after.record, after.game, move.then)) dispatch(move.then.intent, move.then.as);
  }
  useSolo.getState().policy?.saw?.(useStore.getState().game, move);
}
