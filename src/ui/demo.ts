import { DEFAULT_SYSTEM, sides } from "../core";
import type { OwnArmy } from "../bot/startSolo";
import { useStore } from "../store";
import { deployOwn, deploySamples } from "../teach/setup";
import { systemModule } from "../systems";
import { owed } from "../render/showcase";
import { useHelp } from "./help";

/**
 * "Try it now" (front door): a hotseat game of a system with both sample
 * armies deployed and the battle started, so a first-time visitor is playing
 * a turn in one click.
 */
export function startDemo(system: string, mine?: OwnArmy, seated?: () => void): void {
  const s = useStore.getState();
  s.start({ role: "host", mode: "hotseat", name: localStorage.getItem("open-battle:name") ?? "", system });
  let tries = 0;
  const go = () => {
    const { game } = useStore.getState();
    const seats = sides(game);
    if (seats.length < 2 || (game.system ?? DEFAULT_SYSTEM) !== system) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    const { dispatch } = useStore.getState();
    seated?.();
    presetMission();
    if (mine) deployOwn(mine, () => useStore.getState().game, dispatch);
    else deploySamples(() => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6));
    // Ready, and into the battle: the army showcase opens it.
    owed.initial = useStore.getState().record.initial;
    useStore.getState().dispatch({ type: "turn/next" });
    useHelp.setState({ hint: true });
  };
  go();
}

/**
 * The game's first mission on a new game, so there's something to score: with
 * none, every game ended 0-0 (PX, UX 394). Players can change it before the
 * battle. A game whose rules haven't loaded yet (a package) is left as it is.
 */
export function presetMission(): void {
  const { game, dispatch } = useStore.getState();
  if (game.mission || game.turn.round > 0) return;
  let mission;
  try {
    mission = systemModule(game.system).missions?.[0];
  } catch {
    return;
  }
  if (!mission) return;
  const { zones, objectives } = mission.setup(game.table);
  dispatch({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
}
