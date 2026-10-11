import { useMemo } from "react";
import { undoneSeqs, type GameRecord, type GameState, type UnitId } from "../core";
import { findAction } from "../core/content/player";
import { gameText } from "../i18n";
import { useStore } from "../store";

/** A stratagem played on a unit this phase: the small face-up tab by its name plate (UX 499). */
interface StratagemTab {
  seq: number;
  name: string;
  color: string;
}

/** Events that move the turn on: a stratagem's tab lasts until one of them. */
const TURNS = new Set(["turn/next", "turn/prev", "turn/first"]);

/** The stratagems played on each unit since the phase began, from the log (undone ones left out). */
export function stratagemTabs(
  record: GameRecord,
  game: GameState,
  upto = Infinity,
): Map<UnitId, StratagemTab[]> {
  const out = new Map<UnitId, StratagemTab[]>();
  const undone = undoneSeqs(record, upto);
  for (let i = record.events.length - 1; i >= 0; i--) {
    const { seq, event } = record.events[i]!;
    if (seq > upto || undone.has(seq)) continue;
    if (TURNS.has(event.type)) break;
    if (event.type !== "player/action" || !event.targetId || !game.units[event.targetId]) continue;
    const name = event.label ?? gameText(findAction(game, event.action)?.name ?? event.action);
    const tab = { seq, name, color: game.players[event.player]?.color ?? "#999" };
    out.set(event.targetId, [tab, ...(out.get(event.targetId) ?? [])]);
  }
  return out;
}

/** The tabs on the table now (or at the replay's place). */
export function useStratagemTabs(): Map<UnitId, StratagemTab[]> {
  const record = useStore((s) => s.record);
  const game = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  return useMemo(() => stratagemTabs(record, game, scrub ?? Infinity), [record, game, scrub]);
}
