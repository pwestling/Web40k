import { create } from "zustand";
import { DEFAULT_SYSTEM, sides, type GameState } from "../core";
import { sidePlayers } from "../core";
import { seededRng } from "../sandbox/protocol";
import type { BotContext } from "../soak/bot";
import { useStore } from "../store";
import { branchGame } from "../ui/Branch";
import { useHelp } from "../ui/help";
import { lessonSystem } from "./builtin";
import { advance, type Progress } from "./coach";
import type { Lesson } from "./lesson";
import { setUpLesson } from "./setup";
import { soloPlays } from "../bot/solo";

/**
 * The lesson under way on this screen: which step the learner is on, and the
 * opponent bot's own memory (its secrets, how long the game has sat still).
 * `initial` ties the lesson to its game: opening another game ends it.
 */
interface Coach {
  lesson: Lesson | null;
  /** Lesson finished and the learner chose to play on: no card, the computer keeps playing. */
  free: boolean;
  progress: Progress;
  bot: BotContext & { mark?: string };
  initial: GameState | null;
}

export const useCoach = create<Coach>(() => ({
  lesson: null,
  free: false,
  progress: { step: 0, began: [] },
  bot: { rng: Math.random, kept: new Map(), idle: 0, tidy: true },
  initial: null,
}));

/** In a lesson, whether the computer plays this player: its rolls and answers aren't the learner's to make. */
export function computerPlays(game: GameState, player: string | undefined): boolean {
  // Solo against the computer (#45): its side's rolls and answers are its own.
  if (soloPlays(game, player)) return true;
  const { lesson } = useCoach.getState();
  if (!lesson || !player || !game.players[player]) return false;
  return !sidePlayers(game, lesson.you ?? 0).some((p) => p.id === player);
}

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
    // No army showcase here: the coach's first line opens the lesson (PX review).
    useHelp.setState({ hint: false });
    useCoach.setState({
      lesson,
      free: false,
      progress: { step: 0, began: [] },
      bot: { rng: seededRng(Date.now() % 2 ** 31), kept: new Map(), idle: 0, tidy: true },
      initial: useStore.getState().record.initial,
    });
    coachTick();
  };
  go();
}

export function leaveLesson(): void {
  useCoach.setState({ lesson: null, free: false, initial: null });
}

/** "Try another lesson": back to the front door (the game stays saved, as any game does). */
export function backToLobby(): void {
  leaveLesson();
  useStore.getState().session?.leave();
  useStore.setState({ session: null, role: null, scrub: null, selected: null, draft: null });
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
