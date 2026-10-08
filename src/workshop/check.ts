import { t, tn } from "../i18n";
import { lineOf } from "../core/content/shape";
import { problems } from "./drafts";
import { checkDraft, soakDraft, type SoakResult } from "./soak";
import { types } from "./types/client";

/** One part of the Check (#43): passed, failed, or not run (null), in a line, and where in the draft. */
export interface CheckStep {
  id: "code" | "types" | "load" | "soak";
  ok: boolean | null;
  text: string;
  line: number | null;
}

export interface Verdict {
  ok: boolean;
  /** The draft as checked: a later edit makes the verdict stale. */
  source: string;
  steps: CheckStep[];
}

/** The short soak: one bot game to the end of round 2. */
const SOAK_ROUNDS = 2;

const lineAt = (source: string, pos: number) => source.slice(0, pos).split("\n").length;

/** The line a load error points at: one the stack named, or where a bad key of the system is written. */
export function problemLine(source: string, error: string): number | null {
  const at = /line (\d+)/.exec(error);
  return at ? Number(at[1]) : lineOf(source, error);
}

/**
 * The workshop's Check (#43): everything that can be said about a draft
 * without a person playing it, as one verdict. The SDK's types, the draft
 * loaded as the test table would load it (with the shape check of its
 * system), and a short bot game. Type problems and a load failure are
 * reported together; the bot only plays a draft that loads.
 */
export async function checkAll(source: string, progress: (steps: CheckStep[]) => void): Promise<Verdict> {
  const steps: CheckStep[] = [];
  const show = () => progress([...steps]);
  const finish = (): Verdict => ({ ok: steps.every((s) => s.ok !== false), source, steps });

  const issues = problems(source);
  const { syntaxError } = await import("./syntax");
  const syntax = syntaxError(source);
  if (issues.length || syntax) {
    steps.push({
      id: "code",
      ok: false,
      text: issues[0] ?? t("The code doesn't parse at line {line}, column {column}.", syntax!),
      line: syntax?.line ?? null,
    });
    return finish();
  }

  const [typed, loaded] = await Promise.all([
    types.available() ? types.problems(source) : Promise.resolve(null),
    checkDraft(source).then(
      (l) => l.errors[0]?.error ?? null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    ),
  ]);
  const errors = typed?.filter((p) => p.severity === "error") ?? [];
  steps.push(
    typed === null
      ? { id: "types", ok: null, text: t("Types: the type checker isn't available here."), line: null }
      : errors.length
        ? {
            id: "types",
            ok: false,
            text: tn(
              errors.length,
              "Types: {n} problem. Line {line}: {message}",
              "Types: {n} problems. The first, line {line}: {message}",
              { line: lineAt(source, errors[0]!.from), message: errors[0]!.message },
            ),
            line: lineAt(source, errors[0]!.from),
          }
        : { id: "types", ok: true, text: t("Types: everything matches the SDK."), line: null },
  );
  steps.push(
    loaded
      ? {
          id: "load",
          ok: false,
          text: t("Loading: {why}", { why: loaded }),
          line: problemLine(source, loaded),
        }
      : {
          id: "load",
          ok: true,
          text: t("Loading: it loads, and its system has the right shape."),
          line: null,
        },
  );
  show();
  if (loaded) {
    steps.push({ id: "soak", ok: null, text: t("Bot game: not played, since it doesn't load."), line: null });
    return finish();
  }

  let game: SoakResult | null = null;
  await soakDraft(source, [1], (r) => (game = r), SOAK_ROUNDS);
  const r = game as SoakResult | null;
  steps.push(
    !r
      ? { id: "soak", ok: false, text: t("Bot game: it didn't report back."), line: null }
      : r.ok
        ? {
            id: "soak",
            ok: true,
            text: r.finished
              ? t("Bot game: played to the end in {steps} moves.", { steps: r.steps })
              : t("Bot game: {rounds} rounds in {steps} moves, with nothing wrong.", {
                  rounds: SOAK_ROUNDS,
                  steps: r.steps,
                }),
            line: null,
          }
        : {
            id: "soak",
            ok: false,
            text: t("Bot game: {why}", { why: r.failures[0] ?? "" }),
            line: problemLine(source, r.failures[0] ?? ""),
          },
  );
  return finish();
}
