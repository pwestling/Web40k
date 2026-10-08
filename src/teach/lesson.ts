import { gameText } from "../i18n";
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
  /**
   * Answers the computer gives whenever a question offers one, first match
   * first (like "hold", so red holds against a charge rather than flee).
   */
  answers?: string[];
  /** The finish card: a title and what the learner did, ticked off from the log. */
  done?: { title: string; ticks: { label: string; did: string | string[] }[] };
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
  /** The button the step names (its text, like "Declare attack" or "▶"): it pulses while the step is open. */
  point?: string;
  /** Only when this holds as the step comes up (a Fact test, like "engaged > 0" or "said:flees"); otherwise it's skipped. */
  if?: string;
  /**
   * What the coach says once the step is done, about how it went: the first
   * line whose `if` holds. `{roll}`, `{slain}`, `{lost}` and `{target}` fill in
   * from what happened during the step (`say` can use them too, from the step before).
   */
  after?: string | { if?: string; say: string }[];
  /** The opponent plays on but doesn't end its phase or activation while this step is open (the learner acts in its turn too). */
  hold?: boolean;
}

/**
 * What happened during a step, for `after` lines and `if` tests:
 * - roll: the total of the learner's last roll (a charge, an advance);
 * - slain / lost: enemy / own models destroyed;
 * - target: the unit the learner last attacked;
 * - engaged: how many of the learner's units are in contact with an enemy now;
 * - said: what the rules logged during the step (a test "said:keeps its nerve"
 *   holds if a log line contains that text, any case).
 */
export interface Facts {
  roll: number;
  slain: number;
  lost: number;
  target: string;
  engaged: number;
  said?: string;
}

/** A Fact test: "slain > 0", "roll >= 7", or a bare "engaged" (more than 0). */
const TEST = /^\s*(roll|slain|lost|engaged)\s*(?:(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?))?\s*$/;

/** A test on what the rules logged: "said:<text>". */
const SAID = /^\s*said:\s*(\S.*)$/;

/** Whether a lesson's `if` is a test the coach knows. */
const isFactTest = (test: string) => TEST.test(test) || SAID.test(test);

export function factTest(test: string, facts: Facts): boolean {
  const said = SAID.exec(test);
  if (said) return (facts.said ?? "").toLowerCase().includes(said[1]!.trim().toLowerCase());
  const m = TEST.exec(test);
  if (!m) return false;
  const a = facts[m[1] as "roll" | "slain" | "lost" | "engaged"];
  const b = m[3] === undefined ? 0 : Number(m[3]);
  switch (m[2] ?? ">") {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    default:
      return a > b;
  }
}

/** A line with the facts filled in. */
export function fill(text: string, facts: Facts): string {
  return text.replace(/\{(roll|slain|lost|target)\}/g, (_, k: keyof Facts) => String(facts[k]));
}

/** The `after` line for a finished step, if it has one that applies. */
export function afterLine(step: LessonStep, facts: Facts): string | null {
  if (!step.after) return null;
  const lines = typeof step.after === "string" ? [{ say: step.after }] : step.after;
  const line = lines.find((l) => !l.if || factTest(l.if, facts));
  return line ? fill(gameText(line.say), facts) : null;
}

/**
 * When a step is done:
 * - `did`: the learner took an action with that id (a unit action, a
 *   stratagem or a code action), logged an event of that type
 *   ("models/move", "attack/declare"), declared an attack of that kind
 *   ("attack:ranged", "attack:melee"), or made a roll with that label
 *   ("roll:charge"); a list means any of them.
 * - `phase`: it's this phase (by id) of the learner's turn, or of the
 *   opponent's with `side: "them"`.
 * - `yourTurn`: it's the learner's turn and nothing waits on the opponent;
 *   `theirTurn` the reverse.
 * - `round`: the battle has reached this round.
 * - `over`: the battle is over.
 * - `engaged`: one of the learner's units is in contact with an enemy.
 * - `any`: one of these; `all`: every one of these.
 */
export type Until =
  | { did: string | string[] }
  | { phase: string; side?: "you" | "them" }
  | { yourTurn: true }
  | { theirTurn: true }
  | { round: number }
  | { over: true }
  | { engaged: true }
  | { any: Until[] }
  | { all: Until[] };

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
  if (l.answers !== undefined && !(Array.isArray(l.answers) && l.answers.every(isStr)))
    return "answers must be a list of answer ids";
  if (!Array.isArray(l.steps) || !l.steps.length) return "no steps";
  if (l.done !== undefined) {
    const d = l.done;
    if (
      !isObj(d) ||
      !isStr(d.title) ||
      !Array.isArray(d.ticks) ||
      !d.ticks.every(
        (t) => isObj(t) && isStr(t.label) && (isStr(t.did) || (Array.isArray(t.did) && t.did.every(isStr))),
      )
    )
      return "done needs a title and ticks of { label, did }";
  }
  for (const [i, s] of l.steps.entries()) {
    if (!isObj(s) || !isStr(s.say)) return `step ${i + 1} has nothing to say`;
    if (s.until !== undefined && !untilOk(s.until)) return `step ${i + 1}: until isn't one the coach knows`;
    for (const k of ["point", "if"] as const)
      if (s[k] !== undefined && !isStr(s[k])) return `step ${i + 1}: ${k} must be text`;
    if (typeof s.if === "string" && !isFactTest(s.if))
      return `step ${i + 1}: if isn't a test the coach knows`;
    if (s.after !== undefined && !afterOk(s.after))
      return `step ${i + 1}: after must be text or a list of { if?, say }`;
    if (s.hold !== undefined && typeof s.hold !== "boolean")
      return `step ${i + 1}: hold must be true or false`;
    if (
      s.show !== undefined &&
      !(isObj(s.show) && typeof s.show.seat === "number" && typeof s.show.unit === "number")
    )
      return `step ${i + 1}: show needs seat and unit`;
  }
  return null;
}

function afterOk(a: unknown): boolean {
  if (isStr(a)) return true;
  return (
    Array.isArray(a) &&
    a.length > 0 &&
    a.every(
      (l) => isObj(l) && isStr(l.say) && (l.if === undefined || (isStr(l.if) && isFactTest(l.if as string))),
    )
  );
}

function untilOk(u: unknown): boolean {
  if (!isObj(u)) return false;
  if ("any" in u) return Array.isArray(u.any) && u.any.length > 0 && u.any.every(untilOk);
  if ("all" in u) return Array.isArray(u.all) && u.all.length > 0 && u.all.every(untilOk);
  if ("did" in u) return isStr(u.did) || (Array.isArray(u.did) && u.did.length > 0 && u.did.every(isStr));
  if ("phase" in u) return isStr(u.phase) && (u.side === undefined || u.side === "you" || u.side === "them");
  if ("round" in u) return typeof u.round === "number";
  return u.yourTurn === true || u.theirTurn === true || u.over === true || u.engaged === true;
}
