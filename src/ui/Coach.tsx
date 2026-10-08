import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { opponentMove, noteProgress } from "../teach/opponent";
import { coachTick, leaveLesson, redoStep, useCoach } from "../teach/store";
import { waitsOn } from "../teach/coach";
import { legal } from "../soak/bot";

/** How long the opponent waits before each move, so the learner can follow it. */
const BOT_PACE = 500;

/**
 * Teaching mode's coach card: the lesson's current step, what to do, and
 * whether it's done. Mounted in the game screen; while a lesson runs it also
 * plays the other side (teach/opponent.ts), one move at a time.
 */
export function Coach() {
  const lesson = useCoach((s) => s.lesson);
  const progress = useCoach((s) => s.progress);
  const record = useStore((s) => s.record);
  const game = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  const mode = useStore((s) => s.mode);
  const timer = useRef<number | null>(null);

  // Opening another game ends the lesson.
  useEffect(() => {
    const { lesson, initial } = useCoach.getState();
    if (lesson && (mode !== "hotseat" || record.initial !== initial)) leaveLesson();
  }, [record.initial, mode]);

  // Every new event may finish the step, or hand the opponent a move.
  useEffect(() => {
    if (!lesson || scrub !== null) return;
    coachTick();
    if (timer.current !== null) return;
    timer.current = window.setTimeout(function play() {
      timer.current = null;
      const { lesson: now, bot } = useCoach.getState();
      const { record, game, dispatch, scrub } = useStore.getState();
      if (!now || scrub !== null) return;
      const seat = 1 - (now.you ?? 0);
      const move = opponentMove(record, game, bot, seat);
      // Nothing the rules allow just yet (a roll still settling): look again shortly.
      if (!move) {
        if (waitsOn(game, seat)) timer.current = window.setTimeout(play, BOT_PACE);
        return;
      }
      dispatch(move.intent, move.as);
      if (move.then) {
        const after = useStore.getState();
        if (legal(after.record, after.game, move.then)) dispatch(move.then.intent, move.then.as);
      }
      noteProgress(bot, useStore.getState().game);
    }, BOT_PACE);
  }, [lesson, game, scrub]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  if (!lesson || scrub !== null) return null;
  const n = lesson.steps.length;
  const step = lesson.steps[progress.step];
  const began = progress.began[progress.step];
  if (!step)
    return (
      <div className="panel coach done" role="status">
        <span>
          <strong>Lesson done</strong> · {lesson.title}. Play on as long as you like.
        </span>
        <button onClick={leaveLesson}>Close</button>
      </div>
    );
  return (
    <div className="panel coach" role="status" aria-live="polite">
      <div className="row spread">
        <span className="muted small">
          Lesson · {lesson.title} · step {progress.step + 1} of {n}
        </span>
        <button className="quiet" title="Leave the lesson (the game stays)" onClick={leaveLesson}>
          ✕
        </button>
      </div>
      <p>{step.say}</p>
      <div className="row">
        {!step.until && (
          <button className="primary" onClick={() => coachTick(true)}>
            {progress.step + 1 === n ? "Finish" : "Got it"}
          </button>
        )}
        {progress.step > 0 && began !== undefined && began < record.events.at(-1)!.seq && (
          <button title="Go back to where this step began (What if)" onClick={redoStep}>
            Redo this step
          </button>
        )}
      </div>
    </div>
  );
}
