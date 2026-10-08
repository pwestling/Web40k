import { sides } from "../core";
import { useLibrary, type StoredPackage } from "../packages/library";
import { owed } from "../render/showcase";
import { useStore } from "../store";
import { gameModule } from "../systems";
import { deploySamples } from "../teach/setup";
import { useHelp } from "../ui/help";
import { refOf } from "../ui/Packages";
import { APP_BUILD } from "../version";

/**
 * Rift Lanterns (#42), our own game: a whole-game package that ships with the
 * app (games/rift-lanterns), so it plays with nothing to import. It goes in
 * the package library like any package, trusted because it's the app's own,
 * so it's in the lobby's game list for online games too and peers check it by
 * hash as usual. Its text loads after the front door.
 */
export const RIFT_LANTERNS = "rift-lanterns";

let installing: Promise<StoredPackage | null> | null = null;

/** Put the game in this device's package library (once), trusted. */
export function installRiftLanterns(): Promise<StoredPackage | null> {
  installing ??= import("../../games/rift-lanterns/rift-lanterns.js?raw").then(
    async ({ default: source }) => {
      const lib = useLibrary.getState();
      await lib.load();
      const r = await lib.add(new TextEncoder().encode(source), { own: true });
      if (!r.ok) return null;
      if (!r.pkg.trusted) lib.trust(r.pkg.hash, true);
      return useLibrary.getState().packages[r.pkg.hash] ?? r.pkg;
    },
  );
  return installing;
}

/**
 * "Play now, nothing to import": a hotseat game of Rift Lanterns, two
 * warbands picked at random, the first mission set and the battle started.
 */
export async function playRiftLanterns(): Promise<void> {
  const pkg = await installRiftLanterns();
  if (!pkg) return;
  const s = useStore.getState();
  s.start({
    role: "host",
    mode: "hotseat",
    name: localStorage.getItem("open-battle:name") ?? "",
    system: RIFT_LANTERNS,
  });
  useStore.getState().dispatch({
    type: "game/packages",
    app: APP_BUILD,
    system: { id: RIFT_LANTERNS, builtIn: false },
    packages: [refOf(pkg)],
  });
  let tries = 0;
  const go = () => {
    const { game } = useStore.getState();
    const mod = gameModule(RIFT_LANTERNS)?.app;
    if (!mod || game.system !== RIFT_LANTERNS || sides(game).length < 2 || !game.terrain.length) {
      if (tries++ < 200) setTimeout(go, 50);
      return;
    }
    const { dispatch } = useStore.getState();
    const armies = mod.armies ?? [mod.sample(0), mod.sample(1)];
    const a = Math.floor(Math.random() * armies.length);
    const b = (a + 1 + Math.floor(Math.random() * (armies.length - 1))) % armies.length;
    const mission = mod.missions?.[0];
    if (mission) {
      const { zones, objectives } = mission.setup(game.table);
      dispatch({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
    }
    deploySamples(() => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6), [
      armies[a]!,
      armies[b]!,
    ]);
    owed.initial = useStore.getState().record.initial;
    useStore.getState().dispatch({ type: "turn/next" });
    useHelp.setState({ hint: true });
  };
  go();
}
