import { DEFAULT_SYSTEM, sides, sidePlayers, systemOf } from "../core";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { useHelp } from "./help";

/**
 * "Try it now" (front door): a hotseat game of a system with both sample
 * armies deployed and the battle started, so a first-time visitor is playing
 * a turn in one click. Ranked systems deploy their blocks at the list's
 * frontage (or five wide).
 */
export function startDemo(system: string): void {
  const s = useStore.getState();
  s.start({ role: "host", mode: "hotseat", name: localStorage.getItem("open-battle:name") ?? "", system });
  let tries = 0;
  const go = () => {
    const { game, dispatch } = useStore.getState();
    const seats = sides(game);
    if (seats.length < 2 || (game.system ?? DEFAULT_SYSTEM) !== system) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    const ranked = systemOf(game).unitShape.kind === "ranked";
    for (const seat of seats) {
      const owner = sidePlayers(game, seat)[0]!.id;
      const roster = systemModule(system).sample(seat === 1 ? 1 : 0);
      const units = ranked
        ? roster.units.map((u) => ({
            ...u,
            files: u.files ?? Math.min(u.models.length, u.models.length >= 10 ? 5 : u.models.length),
          }))
        : roster.units;
      const now = useStore.getState().game;
      const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
      for (const intent of spawnIntents(now, owner, units, prefix, roster.name)) dispatch(intent, owner);
    }
    // Ready, and into the battle: the army showcase opens it.
    useStore.getState().dispatch({ type: "turn/next" });
    useHelp.setState({ hint: true });
  };
  go();
}
