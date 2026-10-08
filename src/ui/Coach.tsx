import { useEffect, useMemo, useRef } from "react";
import { undoneSeqs, sidePlayers } from "../core";
import { legal } from "../soak/bot";
import { useStore } from "../store";
import { didIds, waitsOn } from "../teach/coach";
import { fill } from "../teach/lesson";
import { opponentMove, noteProgress } from "../teach/opponent";
import { t, translated, gameText } from "../i18n";
import { backToLobby, coachTick, computerPlays, leaveLesson, redoStep, useCoach } from "../teach/store";

/** How long the opponent waits before each move, and on each roll so the learner can follow it. */
const BOT_PACE = 500;
const ROLL_PACE = 1100;

/**
 * Teaching mode's coach card: the lesson's current step, what to do, a line
 * about how the last step went, and the control the step names, pulsing.
 * Mounted in the game screen; while a lesson runs it also plays the other
 * side (teach/opponent.ts), one move at a time.
 */
export function Coach() {
  const lesson = useCoach((s) => s.lesson);
  const free = useCoach((s) => s.free);
  const progress = useCoach((s) => s.progress);
  const record = useStore((s) => s.record);
  const game = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  const mode = useStore((s) => s.mode);
  const timer = useRef<number | null>(null);
  const step = lesson?.steps[progress.step];

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
    const rolling = () => {
      const g = useStore.getState().game;
      return !!(g.attack || g.procedure || g.script?.waiting);
    };
    timer.current = window.setTimeout(
      function play() {
        timer.current = null;
        const { lesson: now, bot, progress } = useCoach.getState();
        const { record, game, dispatch, scrub } = useStore.getState();
        if (!now || scrub !== null) return;
        const seat = 1 - (now.you ?? 0);
        const hold = !!now.steps[progress.step]?.hold;
        const move = opponentMove(record, game, bot, seat, hold);
        // Nothing the rules allow just yet (a roll still settling): look again shortly.
        if (!move) {
          if (waitsOn(game, seat) && !hold) timer.current = window.setTimeout(play, BOT_PACE);
          return;
        }
        dispatch(move.intent, move.as);
        if (move.then) {
          const after = useStore.getState();
          if (legal(after.record, after.game, move.then)) dispatch(move.then.intent, move.then.as);
        }
        noteProgress(bot, useStore.getState().game, move);
      },
      rolling() ? ROLL_PACE : BOT_PACE,
    );
    // The step too: a hold step ending (Skip) lets the computer carry on with nothing new logged.
  }, [lesson, game, scrub, progress.step]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  // Your attack's dice are all in: its panel waits on Done before play goes on.
  const finished =
    (game.attack?.stage === "done" &&
      !computerPlays(game, game.units[game.attack.spec.attackerUnitId]?.owner)) ||
    (!!game.procedure?.run.done && !computerPlays(game, game.procedure.by));
  usePulse(
    lesson && scrub === null && (!free || finished) ? (finished ? t("Done") : step?.point) : undefined,
  );

  // A step to do something whose phase has gone by (the learner pressed on past it) offers Skip.
  const phaseNow = `${game.turn.round}:${game.turn.activeSeat}:${game.turn.phase}`;
  const stepPhase = useRef<{ step: number; phase: string } | null>(null);
  if (stepPhase.current?.step !== progress.step) stepPhase.current = { step: progress.step, phase: phaseNow };
  const passed = stepPhase.current.phase !== phaseNow;

  // A lesson keeps the screen to what the coach talks about (styles.css, body.lesson).
  const coaching = !!lesson && !free;
  useEffect(() => {
    document.body.classList.toggle("lesson", coaching);
    return () => document.body.classList.remove("lesson");
  }, [coaching]);

  // The finish card's ticks: what the learner did over the whole lesson.
  const ticks = useMemo(() => {
    if (!lesson?.done || step) return [];
    const you = lesson.you ?? 0;
    const learners = new Set(sidePlayers(game, you).map((p) => p.id));
    const undone = undoneSeqs(record);
    const from = progress.began[0] ?? 0;
    const did = new Set<string>();
    for (const l of record.events)
      if (l.seq > from && !undone.has(l.seq) && learners.has(l.by))
        for (const id of didIds(l.event)) did.add(id);
    return lesson.done.ticks.map((x) => ({ label: x.label, ok: [x.did].flat().some((id) => did.has(id)) }));
  }, [lesson, step, record, game, progress.began]);

  if (!lesson || free || scrub !== null) return null;
  const n = lesson.steps.length;
  const said = progress.said;
  if (!step)
    return (
      <div className="panel coach done" role="status">
        {said && <p className="coach-said">{said}</p>}
        <strong className="coach-title">
          {lesson.done?.title ? gameText(lesson.done.title) : t("Lesson done")}
        </strong>
        {ticks.length > 0 && (
          <ul className="coach-ticks">
            {ticks.map((x) => (
              <li key={x.label} className={x.ok ? "ok" : ""}>
                {x.ok ? "✓" : "○"} {x.label}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="primary" onClick={() => useCoach.setState({ free: true })}>
            {t("Play on against the computer")}
          </button>
          <button onClick={backToLobby}>{t("Try another lesson")}</button>
        </div>
      </div>
    );
  const began = progress.began[progress.step];
  const facts = progress.facts ?? { roll: 0, slain: 0, lost: 0, target: "", engaged: 0 };
  return (
    <div className="panel coach" role="status" aria-live="polite">
      <div className="row spread">
        <span className="muted small">
          {t("Lesson · {title} · step {step} of {count}", {
            title: gameText(lesson.title),
            step: progress.step + 1,
            count: n,
          })}
        </span>
        <button className="quiet" title={t("Leave the lesson (the game stays)")} onClick={leaveLesson}>
          ✕
        </button>
      </div>
      {said && <p className="coach-said">{said}</p>}
      <p>{fill(step.say, facts)}</p>
      {finished && <p className="muted small">{t("Press Done on the dice panel to carry on.")}</p>}
      <div className="row">
        {!step.until && (
          <button className="primary" onClick={() => coachTick(true)}>
            {progress.step + 1 === n ? t("Finish") : t("Got it")}
          </button>
        )}
        {step.until && (step.hold || passed) && (
          <button
            title={
              step.hold ? t("Let the other side carry on") : t("The game has moved on: skip to the next step")
            }
            onClick={() => coachTick(true)}
          >
            {t("Skip")}
          </button>
        )}
        {progress.step > 0 && began !== undefined && began < (record.events.at(-1)?.seq ?? 0) && (
          <button
            className="quiet"
            title={t("Go back to where this step began (What if)")}
            onClick={redoStep}
          >
            {t("Redo this step")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A soft ring on the button a step names (by its text or title), while the
 * step is open. Buttons come and go as panels open, so it looks again often.
 */
function usePulse(label: string | undefined) {
  useEffect(() => {
    if (!label) return;
    const mark = () => {
      for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
        // Lessons name buttons by their English text; match the button as shown in the chosen language too.
        const text = b.textContent?.trim();
        const hit =
          !b.closest(".replaybar, .coach") &&
          !b.disabled &&
          (text === label ||
            text === translated(label) ||
            text === gameText(label) ||
            (label === "▶" && b.title === t("Next phase")));
        b.classList.toggle("coach-pulse", hit);
      }
    };
    mark();
    const every = window.setInterval(mark, 400);
    return () => {
      window.clearInterval(every);
      for (const b of document.querySelectorAll(".coach-pulse")) b.classList.remove("coach-pulse");
    };
  }, [label]);
}
