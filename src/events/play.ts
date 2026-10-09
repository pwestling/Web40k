import { sides } from "../core";
import type { PlayerId } from "../core";
import { NET_PARAMS } from "../net/config";
import { useLibrary } from "../packages/library";
import { useShelf, type SavedArmy } from "../packages/shelf";
import { myKey } from "../player/card";
import { useStore } from "../store";
import { gameModule, systemModule } from "../systems";
import { armyColor, spawnIntents } from "../systems/wh40k/deploy";
import { installRiftLanterns, RIFT_LANTERNS } from "../games/riftLanterns";
import { dressFromShelf, useDeployed } from "../ui/shelfActions";
import { refOf } from "../ui/Packages";
import { APP_BUILD } from "../version";
import { armyHash, roomFor, type EventDoc } from "./event";
import type { EventPairing } from "../campaign/event";
import { closeEvent, openEvent } from "./open";

/**
 * Playing an event's pairing (#67): one click to its room. The first player
 * of the pairing hosts it and sets the table as the event says (the game, its
 * size, the round's mission, the clocks); both play it ranked, as entering
 * agreed to, so the signed result settles the pairing.
 */

function whenStarted(then: () => void): void {
  if (useStore.getState().session) return then();
  const off = useStore.subscribe((s) => {
    if (!s.session) return;
    off();
    then();
  });
}

export async function playPairing(event: EventDoc, round: number, pairing: EventPairing): Promise<void> {
  const key = await myKey();
  const me = event.entrants.find((e) => e.key === key);
  if (!me || !pairing.players.includes(key)) return;
  const roomId = roomFor(event.id, round, pairing.table);
  const hosting = pairing.players[0] === key;
  const here = new URLSearchParams(location.search);
  const q = new URLSearchParams({ room: roomId });
  for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
  history.replaceState(null, "", `?${q}`);
  if (event.system === RIFT_LANTERNS) await installRiftLanterns();
  closeEvent();
  localStorage.setItem("open-battle:name", me.name);
  useStore.getState().start({
    role: hosting ? "host" : "client",
    mode: "online",
    roomId,
    name: me.name,
    ...(hosting ? { system: event.system } : {}),
  });
  if (hosting) whenStarted(() => setUpTable(event, round, pairing));
}

/** The host sets the table: the game's package, the event's table, clocks, size and the round's mission. */
function setUpTable(event: EventDoc, round: number, pairing: EventPairing): void {
  const { dispatch } = useStore.getState();
  const pkg = Object.values(useLibrary.getState().packages).find(
    (p) => p.trusted && p.manifest.kind === "system" && p.manifest.systems[0] === event.system,
  );
  if (pkg)
    dispatch({
      type: "game/packages",
      app: APP_BUILD,
      system: { id: event.system, builtIn: false },
      packages: [refOf(pkg)],
    });
  dispatch({
    type: "settings/set",
    settings: {
      event: { id: event.id, name: event.name, round, table: pairing.table },
      clock: event.clock ? { minutes: event.clock } : null,
      ...(event.points ? { points: event.points } : {}),
    },
  });
  // The mission once the game's rules are running (a package's take a moment).
  const session = useStore.getState().session;
  const started = Date.now();
  const go = () => {
    const { game } = useStore.getState();
    if (useStore.getState().session !== session || game.turn.round !== 0 || game.mission) return;
    const ready = !!gameModule(event.system) && game.system === event.system && sides(game).length >= 2;
    if (!ready && Date.now() - started < 60_000) {
      setTimeout(go, 200);
      return;
    }
    const missions = systemModule(event.system).missions;
    const want = event.missions[round - 1];
    const mission = (want && missions?.find((m) => m.id === want.id)) || missions?.[0];
    if (!mission) return;
    const { zones, objectives } = mission.setup(game.table);
    dispatch({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
  };
  go();
}

/** This player's registered army on this device's shelf, if it's here (matched by its hash). */
export function registeredArmy(event: EventDoc, key: string | null): SavedArmy | null {
  const me = event.entrants.find((e) => e.key === key);
  if (!me) return null;
  return (
    Object.values(useShelf.getState().armies).find(
      (a) => a.system === event.system && armyHash(a.roster) === me.army,
    ) ?? null
  );
}

/** Put a shelf army on the table for a player, as the army panel would. */
export function deployShelfArmy(army: SavedArmy, owner: PlayerId): void {
  const { game, dispatch } = useStore.getState();
  const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
  for (const intent of spawnIntents(game, owner, army.roster.units, prefix, army.roster.name))
    dispatch(intent, owner);
  if (army.roster.army) dispatch({ type: "player/army", army: army.roster.army }, owner);
  if (!army.color) {
    const color = armyColor(game, owner, army.roster.color);
    if (color) dispatch(color, owner);
  }
  useDeployed.setState({ [owner]: { roster: army.roster, prefix, shelfId: army.id } });
  void dressFromShelf(army, owner, prefix);
}

/** Leave the game for the event's page. */
export function backToEvent(id: string): void {
  useStore.getState().session?.leave();
  useStore.setState({ session: null, role: null, scrub: null, selected: null, draft: null });
  const here = new URLSearchParams(location.search);
  const q = new URLSearchParams();
  for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
  history.replaceState(null, "", q.size ? `?${q}` : location.pathname);
  openEvent(id);
}
