import { DEFAULT_SYSTEM, sides } from "../core";
import { useStore } from "../store";
import { deploySamples } from "../teach/setup";
import { owed } from "../render/showcase";
import { useHelp } from "./help";

/**
 * "Try it now" (front door): a hotseat game of a system with both sample
 * armies deployed and the battle started, so a first-time visitor is playing
 * a turn in one click.
 */
export function startDemo(system: string): void {
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
    deploySamples(() => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6));
    // Ready, and into the battle: the army showcase opens it.
    owed.initial = useStore.getState().record.initial;
    useStore.getState().dispatch({ type: "turn/next" });
    useHelp.setState({ hint: true });
  };
  go();
}
