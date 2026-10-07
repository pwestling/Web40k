import type { GameState } from "../../core";
import { currentSlot } from "../../core/content/turn";
import { stackOf } from "./command";
import { needsRoll } from "./reinforce";
import { conquest } from "./system";

/** Leaving the Command phase with reinforcements or a stack still to do (UX 117). */
export function leavingCommand(game: GameState): string[] {
  if (currentSlot(game)?.id !== "command") return [];
  const own = game.modules?.[conquest.id] ?? {};
  const out: string[] = [];
  for (const p of Object.values(game.players).filter((p) => p.seat !== undefined)) {
    if (needsRoll(game, own, p.id)) out.push(`${p.name} hasn't brought in reinforcements`);
    const onTable = Object.values(game.units).some((u) => u.owner === p.id && !u.status?.reserves);
    if (onTable && !stackOf(game, p.id)) out.push(`${p.name} hasn't locked in a command stack`);
  }
  return out;
}
