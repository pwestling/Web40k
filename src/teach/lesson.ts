import { readLiteral, readManifest, type Manifest } from "../packages/manifest";

/**
 * Teaching mode's lessons: a guided first game of a system. A lesson is plain
 * data in a lesson package (manifest kind "lesson"), read like the manifest
 * without running anything, so a lesson never needs trusting. The learner
 * plays one side on this screen and the soak bot plays the other
 * (teach/opponent.ts); the coach card (ui/Coach.tsx) walks the steps.
 */

export interface Lesson {
  id: string;
  title: string;
  /** The system it teaches (a built-in id, or a prefix like "forty-k"). */
  system: string;
  /** One line for the front door. */
  summary: string;
  /** The seat the learner plays (default 0); the bot plays the other. */
  you?: number;
  /** Where some units start, so the lesson has something to shoot and charge. */
  place?: Placement[];
  steps: LessonStep[];
}

/** Move one sample unit (by its place in the sample list) so its middle stands at `at`, in inches from the table's centre. */
export interface Placement {
  seat: number;
  unit: number;
  at: { x: number; y: number };
}

export interface LessonStep {
  /** What the coach says. */
  say: string;
  /** When the step is done. Without it the learner presses "Got it". */
  until?: Until;
  /** A unit to select for the learner as the step opens. */
  show?: { seat: number; unit: number };
}

/**
 * When a step is done:
 * - `did`: the learner took an action with that id (a unit action, a
 *   stratagem or a code action), logged an event of that type
 *   ("models/move", "attack/declare"), or made a roll with that label
 *   ("roll:charge"); a list means any of them.
 * - `phase`: it's this phase (by id) of the learner's turn, or of the
 *   opponent's with `side: "them"`.
 * - `yourTurn`: it's the learner's turn and nothing waits on the opponent;
 *   `theirTurn` the reverse.
 * - `round`: the battle has reached this round.
 * - `over`: the battle is over.
 * - `any`: one of these.
 */
export type Until =
  | { did: string | string[] }
  | { phase: string; side?: "you" | "them" }
  | { yourTurn: true }
  | { theirTurn: true }
  | { round: number }
  | { over: true }
  | { any: Until[] };

export interface LessonPackage {
  manifest: Manifest;
  lessons: Lesson[];
}

/** A lesson package's manifest and lessons, read as data. */
export function readLessonPackage(source: string): LessonPackage | { error: string } {
  const m = readManifest(source);
  if ("error" in m) return m;
  if (m.manifest.kind !== "lesson") return { error: "That isn't a lesson package." };
  const lit = readLiteral(source, "lessons");
  if (!lit) return { error: "The package has no `export const lessons = [...]`." };
  if ("error" in lit) return lit;
  if (!Array.isArray(lit.value)) return { error: "lessons must be a list." };
  const lessons: Lesson[] = [];
  for (const [i, l] of lit.value.entries()) {
    const why = lessonProblem(l);
    if (why) return { error: `Lesson ${i + 1}: ${why}` };
    lessons.push(l as Lesson);
  }
  return { manifest: m.manifest, lessons };
}

const isStr = (v: unknown) => typeof v === "string" && v.trim() !== "";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function lessonProblem(l: unknown): string | null {
  if (!isObj(l)) return "not an object";
  for (const k of ["id", "title", "system", "summary"]) if (!isStr(l[k])) return `missing ${k}`;
  if (l.you !== undefined && l.you !== 0 && l.you !== 1) return "you must be 0 or 1";
  if (l.place !== undefined) {
    if (!Array.isArray(l.place)) return "place must be a list";
    for (const p of l.place)
      if (
        !isObj(p) ||
        typeof p.seat !== "number" ||
        typeof p.unit !== "number" ||
        !isObj(p.at) ||
        typeof p.at.x !== "number" ||
        typeof p.at.y !== "number"
      )
        return "each place needs seat, unit and at {x, y}";
  }
  if (!Array.isArray(l.steps) || !l.steps.length) return "no steps";
  for (const [i, s] of l.steps.entries()) {
    if (!isObj(s) || !isStr(s.say)) return `step ${i + 1} has nothing to say`;
    if (s.until !== undefined && !untilOk(s.until)) return `step ${i + 1}: until isn't one the coach knows`;
    if (
      s.show !== undefined &&
      !(isObj(s.show) && typeof s.show.seat === "number" && typeof s.show.unit === "number")
    )
      return `step ${i + 1}: show needs seat and unit`;
  }
  return null;
}

function untilOk(u: unknown): boolean {
  if (!isObj(u)) return false;
  if ("any" in u) return Array.isArray(u.any) && u.any.length > 0 && u.any.every(untilOk);
  if ("did" in u) return isStr(u.did) || (Array.isArray(u.did) && u.did.length > 0 && u.did.every(isStr));
  if ("phase" in u) return isStr(u.phase) && (u.side === undefined || u.side === "you" || u.side === "them");
  if ("round" in u) return typeof u.round === "number";
  return u.yourTurn === true || u.theirTurn === true || u.over === true;
}
