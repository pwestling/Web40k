import { playRiftLanterns, RIFT_LANTERNS } from "../games/riftLanterns";
import type { SavedArmy } from "../packages/shelf";
import type { ImportedRoster } from "../systems/wh40k/roster";
import { startDemo } from "../ui/demo";
import type { Level } from "./player";
import { armSolo, nameSoloSides } from "./solo";

/** The player's own army for a game against the computer: off their shelf, or a roster just read. */
export interface OwnArmy {
  roster: ImportedRoster;
  shelf?: SavedArmy;
}

/**
 * "Play the computer" (#45): the game set up as for Try, you on the near
 * side, the computer on the far side at the level picked. You field your own
 * army when you bring one (#56); the computer fields its sample army.
 */
export function startSolo(system: string, level: Level, mine?: OwnArmy): void {
  if (system === RIFT_LANTERNS) {
    void playRiftLanterns(mine, () => nameSoloSides(level)).then(() => armSolo(level));
    return;
  }
  startDemo(system, mine, () => nameSoloSides(level));
  armSolo(level);
}
