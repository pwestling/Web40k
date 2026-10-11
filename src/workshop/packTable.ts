import { DEFAULT_SYSTEM, sidePlayers, sides, systemOf, type ArmyPack, type PlayerId } from "../core";
import { applyPack, type ReadPack } from "../packages/faction";
import { systemMatches, type StoredPackage } from "../packages/library";
import type { SavedArmy } from "../packages/shelf";
import { quiet } from "../render/showcase";
import { useStore } from "../store";
import { systemModule } from "../systems";
import type { ImportedRoster } from "../systems/wh40k/roster";
import { deploySamples } from "../teach/setup";
import { refOf } from "../ui/Packages";
import { dressFromShelf } from "../ui/shelfActions";
import { APP_BUILD } from "../version";

/**
 * The pack workshop's test table (#79): a hotseat game of the army the pack
 * is built against, with the draft pack on it, against the game's sample
 * army. Each save puts the pack's new rules on the army already on the
 * table (and its code into the game's packages), the way a module draft
 * hot-reloads.
 */

/** An army a pack can be built against: one of the player's shelf armies, or a sample army. */
interface PackArmy {
  /** The shelf id, or `sample:<seat>`. */
  key: string;
  name: string;
  system: string;
  roster: ImportedRoster;
  shelf?: SavedArmy;
}

/** The armies a pack for these systems can be built against: the shelf's, then the game's samples. */
export function packArmies(shelf: Record<string, SavedArmy>, systems: string[]): PackArmy[] {
  const fits = (id: string) => systems.some((s) => systemMatches(s, id));
  const mine = Object.values(shelf)
    .filter((a) => fits(a.system) && a.roster.units.length)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((a) => ({ key: a.id, name: a.name, system: a.system, roster: a.roster, shelf: a }));
  if (!fits(DEFAULT_SYSTEM)) return mine;
  const samples = ([0, 1] as const).map((seat) => {
    const roster = systemModule(DEFAULT_SYSTEM).sample(seat);
    return { key: `sample:${seat}`, name: roster.name, system: DEFAULT_SYSTEM, roster };
  });
  return [...mine, ...samples];
}

/** The army's ref for the draft's save, as a pack loaded by link would give it (no link). */
function draftRef(pkg: StoredPackage, code: boolean): ArmyPack {
  return {
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    hash: pkg.hash,
    bytes: pkg.bytes,
    ...(code ? { code: true } : {}),
  };
}

/** The test table now running: whose army it is, where its units are, and the pack on it. */
let table: { owner: PlayerId; prefix: string; army: PackArmy; system: string } | null = null;

/** The army with the draft pack on it. */
const withDraft = (army: PackArmy, pkg: StoredPackage, read: ReadPack, system: string) =>
  applyPack(army.roster, read.pack, draftRef(pkg, read.code), systemOf({ system })).roster;

/** The game's packages with this pack's code in (or out, when it has none now). */
function packCode(pkg: StoredPackage, code: boolean): void {
  const { game, dispatch } = useStore.getState();
  const on = game.packages?.packages ?? [];
  const next = [...on.filter((p) => p.id !== pkg.manifest.id), ...(code ? [refOf(pkg)] : [])];
  if (JSON.stringify(next) === JSON.stringify(on)) return;
  dispatch({
    type: "game/packages",
    app: APP_BUILD,
    system: { id: game.system ?? DEFAULT_SYSTEM, builtIn: true },
    packages: next,
    ...(game.turn.round > 0
      ? {
          agreed: Object.values(game.players)
            .filter((p) => p.seat !== undefined)
            .map((p) => p.id),
        }
      : {}),
  });
}

/**
 * Start the test table: a hotseat game of the army's system, the army with
 * the pack on it on the near side, the sample army on the far side, and the
 * battle begun. Resolves once the armies are down (false if the game didn't start).
 */
export function startPackTable(army: PackArmy, pkg: StoredPackage, read: ReadPack): Promise<boolean> {
  const s = useStore.getState();
  if (s.session) {
    s.session.leave();
    useStore.setState({ session: null, role: null, scrub: null, selected: null, draft: null });
  }
  const system = army.system;
  useStore.getState().start({
    role: "host",
    mode: "hotseat",
    name: localStorage.getItem("open-battle:name") ?? "",
    system,
  });
  return new Promise((resolve) => {
    let tries = 0;
    const go = () => {
      const { game, dispatch } = useStore.getState();
      if ((game.system ?? DEFAULT_SYSTEM) !== system || sides(game).length < 2) {
        if (tries++ < 200) setTimeout(go, 50);
        else resolve(false);
        return;
      }
      quiet.initial = useStore.getState().record.initial;
      const tag = crypto.randomUUID().slice(0, 6);
      const theirs = systemModule(system).sample(army.key === "sample:1" ? 0 : 1);
      deploySamples(() => useStore.getState().game, dispatch, tag, [
        withDraft(army, pkg, read, system),
        theirs,
      ]);
      const owner = sidePlayers(useStore.getState().game, 0)[0]!.id;
      table = { owner, prefix: `${owner}-${tag}`, army, system };
      if (army.shelf) void dressFromShelf(army.shelf, owner, table.prefix);
      packCode(pkg, read.code);
      useStore.getState().dispatch({ type: "turn/next" });
      resolve(true);
    };
    go();
  });
}

/**
 * A new save onto the running test table: each unit's abilities and the
 * army's rules and stratagems as the pack now has them, and its code. False
 * when no test table of this army is running.
 */
export function reloadPackTable(pkg: StoredPackage, read: ReadPack): boolean {
  const { game, dispatch, session } = useStore.getState();
  if (!table || !session || (game.system ?? DEFAULT_SYSTEM) !== table.system) return false;
  const { owner, prefix, army, system } = table;
  const roster = withDraft(army, pkg, read, system);
  roster.units.forEach((u, i) => {
    const unit = game.units[`${prefix}-${i}`];
    if (!unit?.sheet) return;
    for (const a of u.sheet.abilities) {
      const now = unit.sheet.abilities.find((b) => b.name === a.name);
      if (!now || JSON.stringify(now.auto ?? null) === JSON.stringify(a.auto ?? null)) continue;
      dispatch({ type: "unit/automate", id: unit.id, ability: a.name, auto: a.auto ?? null }, owner);
    }
  });
  if (roster.army) dispatch({ type: "player/army", army: roster.army }, owner);
  packCode(pkg, read.code);
  return true;
}
