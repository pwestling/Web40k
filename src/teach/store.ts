import { create } from "zustand";
import { DEFAULT_SYSTEM, sides, type GameState } from "../core";
import { owed } from "../render/showcase";
import { seededRng } from "../sandbox/protocol";
import type { BotContext } from "../soak/bot";
import { useStore } from "../store";
import { branchGame } from "../ui/Branch";
import { useHelp } from "../ui/help";
import { lessonSystem } from "./builtin";
import { advance, type Progress } from "./coach";
import type { Lesson } from "./lesson";
import { setUpLesson } from "./setup";

/**
 * The lesson under way on this screen: which step the learner is on, and the
 * opponent bot's own memory (its secrets, how long the game has sat still).
 * `initial` ties the lesson to its game: opening another game ends it.
 */
interface Coach {
  lesson: Lesson | null;
  progress: Progress;
  bot: BotContext & { mark?: string };
  initial: GameState | null;
}

export const useCoach = create<Coach>(() => ({
  lesson: null,
  progress: { step: 0, began: [] },
  bot: { rng: Math.random, kept: new Map(), idle: 0, tidy: true },
  initial: null,
}));

/** Start a lesson: a hotseat game of its system, its table set up, the learner to play first. */
export function startLesson(lesson: Lesson): void {
  const system = lessonSystem(lesson);
  if (!system) return;
  useStore.getState().start({
    role: "host",
    mode: "hotseat",
    name: localStorage.getItem("open-battle:name") ?? "",
    system,
  });
  let tries = 0;
  const go = () => {
    const { game } = useStore.getState();
    if (sides(game).length < 2 || (game.system ?? DEFAULT_SYSTEM) !== system) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    const { dispatch } = useStore.getState();
    setUpLesson(lesson, () => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6));
    // The army showcase opens the battle, as in the demos.
    owed.initial = useStore.getState().record.initial;
    useHelp.setState({ hint: false });
    useCoach.setState({
      lesson,
      progress: { step: 0, began: [] },
      bot: { rng: seededRng(Date.now() % 2 ** 31), kept: new Map(), idle: 0, tidy: true },
      initial: useStore.getState().record.initial,
    });
    coachTick();
  };
  go();
}

export function leaveLesson(): void {
  useCoach.setState({ lesson: null, initial: null });
}

/** Move the lesson on from the log (and a "Got it"); select the unit a new step points at. */
export function coachTick(gotIt = false): void {
  const { lesson, progress } = useCoach.getState();
  if (!lesson) return;
  const { record, game, select } = useStore.getState();
  const next = advance(lesson, progress, record, game, gotIt);
  if (next.step === progress.step && next.began.length === progress.began.length) return;
  useCoach.setState({ progress: next });
  const show = lesson.steps[next.step]?.show;
  if (show && next.began.length !== progress.began.length) {
    const players = new Set(
      Object.values(game.players)
        .filter((p) => p.seat === show.seat)
        .map((p) => p.id),
    );
    const unit = Object.values(game.units).filter((u) => players.has(u.owner))[show.unit];
    if (unit) select(unit.id);
  }
}

/** "Redo this step": What if from where the step began, on this screen, still on this step. */
export function redoStep(): void {
  const { progress } = useCoach.getState();
  const seq = progress.began[progress.step];
  if (seq === undefined) return;
  branchGame(seq, "hotseat");
  useCoach.setState({ initial: useStore.getState().record.initial });
}

if (import.meta.env.DEV) Object.assign(globalThis, { openBattleCoach: useCoach });
