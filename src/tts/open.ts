import { DEFAULT_SYSTEM, sidePlayers, sides } from "../core";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { applyLayout } from "../tables/actions";
import { deploySamples } from "../teach/setup";
import { presetMission } from "../ui/demo";
import { dressFromShelf, useDeployed } from "../ui/shelfActions";
import type { BroughtTable } from "./bring";

/**
 * "Open a TTS save as a game" (#73): a game on one screen of the system the
 * player picked, on the save's table, with each army where it stood and in
 * its figures. A side with no army on the table gets the system's sample.
 * The battle isn't started: players check the table first.
 */
export function openTtsGame(brought: BroughtTable): void {
  const system = brought.table.system;
  const s = useStore.getState();
  s.start({ role: "host", mode: "hotseat", name: localStorage.getItem("open-battle:name") ?? "", system });
  let tries = 0;
  const go = async () => {
    const { game } = useStore.getState();
    if (sides(game).length < 2 || (game.system ?? DEFAULT_SYSTEM) !== system) {
      if (tries++ < 40) setTimeout(() => void go(), 50);
      return;
    }
    await applyLayout(brought.table.layout, { key: `table:${brought.table.id}`, name: brought.table.name });
    presetMission();
    const get = () => useStore.getState().game;
    const { dispatch } = useStore.getState();
    const tag = crypto.randomUUID().slice(0, 6);
    const bySide = (side: 0 | 1) => brought.armies.find((a) => a.side === side)?.army;
    deploySamples(get, dispatch, tag, [
      bySide(0)?.roster ?? systemModule(system).sample(0),
      bySide(1)?.roster ?? systemModule(system).sample(1),
    ]);
    for (const side of [0, 1] as const) {
      const army = bySide(side);
      const owner = sidePlayers(get(), side)[0]?.id;
      if (!army || !owner) continue;
      const prefix = `${owner}-${tag}`;
      useDeployed.setState({ [owner]: { roster: army.roster, prefix, shelfId: army.id } });
      await dressFromShelf(army, owner, prefix);
    }
  };
  void go();
}
