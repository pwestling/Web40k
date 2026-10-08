import { playRiftLanterns, RIFT_LANTERNS } from "../games/riftLanterns";
import { startDemo } from "../ui/demo";
import type { Level } from "./player";
import { armSolo } from "./solo";

/**
 * "Play the computer" (#45): the game's sample armies set up as for Try,
 * you on the near side, the computer on the far side at the level picked.
 */
export function startSolo(system: string, level: Level): void {
  if (system === RIFT_LANTERNS) {
    void playRiftLanterns().then(() => armSolo(level));
    return;
  }
  startDemo(system);
  armSolo(level);
}
