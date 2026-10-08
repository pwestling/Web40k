import { useMemo } from "react";
import { sidePlayers } from "../core";
import { momentsOf } from "../core/moments";
import { t, tn } from "../i18n";
import { gameStats } from "../core/stats";
import { useStore } from "../store";
import { useGame } from "../ui/hooks";
import { characterName, levelName, useSolo } from "./solo";

/**
 * At the end of a game against the computer (PX solo review 4): who it was,
 * and its best moment, so losing reads as being outplayed by someone.
 */
export function BestMoment() {
  const game = useGame();
  const record = useStore((s) => s.record);
  const session = useStore((s) => s.session);
  const solo = useSolo();
  const level = solo.level && solo.session === session ? solo.level : null;
  const best = useMemo(() => {
    if (!level) return null;
    const ids = new Set(sidePlayers(game, solo.seat).map((p) => p.id));
    const moment = momentsOf(record)
      .filter((m) => m.kind !== "mvp" && m.player && ids.has(m.player))
      .sort((a, b) => b.score - a.score)[0];
    if (moment) return { when: moment.when, line: moment.line };
    // Nothing stood out: its biggest kill, else the most it scored in a round.
    const kill = gameStats(record)
      .units.filter((u) => ids.has(u.owner) && u.slain > 0)
      .sort((a, b) => b.slain - a.slain)[0];
    if (kill)
      return {
        when: null,
        line: tn(kill.slain, "{unit} took down {n} enemy model", "{unit} took down {n} enemy models", {
          unit: kill.name,
        }),
      };
    const score = (game.scores ?? [])
      .filter((s) => s.seat === solo.seat && s.vp > 0 && !s.skipped)
      .sort((a, b) => b.vp - a.vp)[0];
    return score ? { when: t("Round {n}", { n: score.round }), line: score.why } : null;
  }, [level, game, record, solo.seat]);
  if (!level) return null;
  const name = t("{name} ({level})", { name: characterName(level), level: levelName(level) });
  return (
    <p className="best-moment muted">
      {best
        ? best.when
          ? t("{name}'s best moment, {when}: {line}", { name, when: best.when, line: best.line })
          : t("{name}'s best moment: {line}", { name, line: best.line })
        : t("You played {name}.", { name })}
    </p>
  );
}
