import { sides } from "../core";
import { useLibrary, type StoredPackage } from "../packages/library";
import { owed } from "../render/showcase";
import { useStore } from "../store";
import { gameModule } from "../systems";
import { deployOwn, deploySamples } from "../teach/setup";
import type { OwnArmy } from "../bot/startSolo";
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
/** Brinewatch (#69), our second: a skirmish game of model-by-model goes (games/brinewatch). */
export const BRINEWATCH = "brinewatch";

/** The app's own games, by system id: each one's package text, loaded when first wanted. */
const OWN: Record<string, () => Promise<{ default: string }>> = {
  [RIFT_LANTERNS]: () => import("../../games/rift-lanterns/rift-lanterns.js?raw"),
  [BRINEWATCH]: () => import("../../games/brinewatch/brinewatch.js?raw"),
};

/** Whether the system is one of the app's own games, which ship with it and play with nothing to import. */
export function ownGame(system: string): boolean {
  return system in OWN;
}

const installing = new Map<string, Promise<StoredPackage | null>>();

/** Put one of our own games in this device's package library (once), trusted. */
export function installOwnGame(system: string): Promise<StoredPackage | null> {
  let got = installing.get(system);
  if (got) return got;
  const load = OWN[system];
  if (!load) return Promise.resolve(null);
  got = load().then(async ({ default: source }) => {
    const lib = useLibrary.getState();
    await lib.load();
    const r = await lib.add(new TextEncoder().encode(source), { own: true });
    if (!r.ok) return null;
    if (!r.pkg.trusted) lib.trust(r.pkg.hash, true);
    return useLibrary.getState().packages[r.pkg.hash] ?? r.pkg;
  });
  installing.set(system, got);
  return got;
}

/** Put Rift Lanterns in this device's package library (once), trusted. */
export function installRiftLanterns(): Promise<StoredPackage | null> {
  return installOwnGame(RIFT_LANTERNS);
}

/**
 * "Play now, nothing to import": a hotseat game of Rift Lanterns, two
 * warbands picked at random, the first mission set and the battle started.
 */
export function playRiftLanterns(mine?: OwnArmy, seated?: () => void): Promise<void> {
  return playOwnGame(RIFT_LANTERNS, mine, seated);
}

/** Play now for any of our own games (see playRiftLanterns): two of its armies at random, its first mission. */
export async function playOwnGame(system: string, mine?: OwnArmy, seated?: () => void): Promise<void> {
  const pkg = await installOwnGame(system);
  if (!pkg) return;
  const s = useStore.getState();
  s.start({
    role: "host",
    mode: "hotseat",
    name: localStorage.getItem("open-battle:name") ?? "",
    system,
  });
  useStore.getState().dispatch({
    type: "game/packages",
    app: APP_BUILD,
    system: { id: system, builtIn: false },
    packages: [refOf(pkg)],
  });
  // Wait for the rules however long they take (a slow device, a retry): never give up silently, as
  // long as this is still the game Play now started (PX playtest item 7). The notice offers a Retry.
  const session = useStore.getState().session;
  const go = () => {
    const { game } = useStore.getState();
    if (useStore.getState().session !== session || game.turn.round !== 0) return;
    const mod = gameModule(system)?.app;
    if (!mod || game.system !== system || sides(game).length < 2 || !game.terrain.length) {
      setTimeout(go, 100);
      return;
    }
    const { dispatch } = useStore.getState();
    seated?.();
    const armies = mod.armies ?? [mod.sample(0), mod.sample(1)];
    const a = Math.floor(Math.random() * armies.length);
    const b = (a + 1 + Math.floor(Math.random() * (armies.length - 1))) % armies.length;
    const mission = mod.missions?.[0];
    if (mission) {
      const { zones, objectives } = mission.setup(game.table);
      dispatch({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
    }
    if (mine) deployOwn(mine, () => useStore.getState().game, dispatch, armies[b]!);
    else
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

/**
 * At a real table (UX 358): Rift Lanterns on this one phone, kept as a
 * companion for printed or real models. The players pick and deploy their
 * warbands the companion's way.
 */
export function playRiftAtTable(): Promise<void> {
  return playOwnAtTable(RIFT_LANTERNS);
}

/** At a real table for any of our own games (see playRiftAtTable). */
export async function playOwnAtTable(system: string): Promise<void> {
  const pkg = await installOwnGame(system);
  if (!pkg) return;
  useStore.getState().start({
    role: "host",
    mode: "hotseat",
    name: localStorage.getItem("open-battle:name") ?? "",
    system,
  });
  const { dispatch } = useStore.getState();
  dispatch({
    type: "game/packages",
    app: APP_BUILD,
    system: { id: system, builtIn: false },
    packages: [refOf(pkg)],
  });
  dispatch({ type: "settings/set", settings: { companion: true } });
  // The first mission, set once the rules have loaded (PX print and play): one less thing to find.
  const session = useStore.getState().session;
  const pick = () => {
    const { game } = useStore.getState();
    if (useStore.getState().session !== session || game.turn.round !== 0 || game.mission) return;
    const mission = gameModule(system)?.app?.missions?.[0];
    if (!mission || game.system !== system) return void setTimeout(pick, 100);
    const { zones, objectives } = mission.setup(game.table);
    useStore
      .getState()
      .dispatch({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
  };
  pick();
}
