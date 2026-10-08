import { useMemo } from "react";
import { sidePlayers } from "../core";
import { momentsOf } from "../core/moments";
import { t } from "../i18n";
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
    return (
      momentsOf(record)
        .filter((m) => m.kind !== "mvp" && m.player && ids.has(m.player))
        .sort((a, b) => b.score - a.score)[0] ?? null
    );
  }, [level, game, record, solo.seat]);
  if (!level) return null;
  const name = t("{name} ({level})", { name: characterName(level), level: levelName(level) });
  return (
    <p className="best-moment muted">
      {best
        ? t("{name}'s best moment, {when}: {line}", { name, when: best.when, line: best.line })
        : t("You played {name}.", { name })}
    </p>
  );
}
