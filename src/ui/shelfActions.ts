import { safeFileName, saveJson } from "./files";
import { create } from "zustand";
import { DEFAULT_SYSTEM, type GameState, type Intent, type PlayerId } from "../core";
import { fromBase64, toBase64 } from "../assets/base64";
import { getCached, putCached } from "../assets/cache";
import { useAssets } from "../assets/store";
import {
  armyAssets,
  ARMY_FORMAT,
  armyFromGame,
  readArmy,
  useShelf,
  type ArmyFile,
  type SavedArmy,
} from "../packages/shelf";
import { t } from "../i18n";
import { useStore } from "../store";
import { isYellowscribe, toYellowscribe } from "../systems/wh40k/yellowscribe";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { armyColor, spawnIntents } from "../systems/wh40k/deploy";

/** What each player deployed in this game, so it can go on the shelf (and from which shelf entry). */
export const useDeployed = create<
  Record<PlayerId, { roster: ImportedRoster; prefix: string; shelfId?: string }>
>(() => ({}));

/** Put a player's army, as it stands in this game, on the shelf; returns its shelf id. */
export function saveToShelf(owner: PlayerId): string | null {
  const deployed = useDeployed.getState()[owner];
  if (!deployed) return null;
  const army = armyFromGame(useStore.getState().game, owner, deployed, deployed.shelfId);
  // Where it came from stays with it (UX 480).
  const was = deployed.shelfId ? useShelf.getState().armies[deployed.shelfId] : undefined;
  if (was?.from) army.from = was.from;
  useShelf.getState().put(army);
  useDeployed.setState({ [owner]: { ...deployed, shelfId: army.id } });
  return army.id;
}

/**
 * A shelf army's units for a player (UX 480). On the table it was brought on
 * from TTS, every model stands where it stood, turned through the centre for
 * a player on the other side; on any other table it has no places and
 * deploys in its zone like any list.
 */
export function unitsToDeploy(
  army: SavedArmy,
  game: GameState,
  owner: PlayerId,
): { units: ImportedRoster["units"]; keepPlaces: boolean } {
  const units = army.roster.units;
  if (!units.some((u) => u.models.some((m) => m.at))) return { units, keepPlaces: false };
  const home = !!army.from && game.tableSource?.key === `table:${army.from.table}`;
  const side = (game.players[owner]?.seat ?? 0) === 0 ? 0 : 1;
  const turn = home && side !== army.from!.side;
  return {
    keepPlaces: home,
    units: units.map((u) => ({
      ...u,
      models: u.models.map(({ at, ...m }) =>
        !home || !at
          ? m
          : { ...m, at: turn ? { x: -at.x, y: -at.y, facing: (at.facing + Math.PI) % (2 * Math.PI) } : at },
      ),
    })),
  };
}

/**
 * Put a shelf army on the table for a player, as the army panel would: its
 * places on its own table, its rules, colour and dice, and its figures. The
 * host sends for a guest with `dispatch` (an army brought for them, UX 481).
 */
export function deployShelfArmy(
  army: SavedArmy,
  owner: PlayerId,
  dispatch: (intent: Intent, as: PlayerId) => void = (intent, as) => useStore.getState().dispatch(intent, as),
): void {
  const { game } = useStore.getState();
  const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
  const { units, keepPlaces } = unitsToDeploy(army, game, owner);
  for (const intent of spawnIntents(game, owner, units, prefix, army.roster.name, keepPlaces))
    dispatch(intent, owner);
  if (army.roster.army) dispatch({ type: "player/army", army: army.roster.army }, owner);
  if (!army.color) {
    const color = armyColor(game, owner, army.roster.color);
    if (color) dispatch(color, owner);
  }
  useDeployed.setState({ [owner]: { roster: { ...army.roster, units }, prefix, shelfId: army.id } });
  void dressFromShelf(army, owner, prefix, dispatch);
}

/** A figure asset, from this page or this device's cache. */
async function asset(id: string) {
  const here = useAssets.getState().assets[id];
  if (here) return here;
  const cached = await getCached(id);
  if (cached) useAssets.getState().addAsset(cached);
  return cached;
}

/**
 * After a shelf army's units are deployed: dress them in their figures, and
 * give the player their dice and colour (unless another player has it).
 */
export async function dressFromShelf(
  army: SavedArmy,
  owner: PlayerId,
  prefix: string,
  dispatch: (intent: Intent, as: PlayerId) => void = (intent, as) => useStore.getState().dispatch(intent, as),
): Promise<void> {
  const { game } = useStore.getState();
  if (army.dice !== undefined) dispatch({ type: "player/dice", player: owner, dice: army.dice }, owner);
  const taken = Object.values(game.players).some((p) => p.id !== owner && p.color === army.color);
  if (army.color && !taken && game.players[owner]?.color !== army.color)
    dispatch({ type: "player/color", player: owner, color: army.color }, owner);
  for (const [i, byKey] of Object.entries(army.figures)) {
    const unitId = `${prefix}-${i}`;
    // One event per figure, covering every profile that wears it.
    const groups = new Map<string, string[]>();
    for (const [key, f] of Object.entries(byKey))
      groups.set(JSON.stringify(f.figure), [...(groups.get(JSON.stringify(f.figure)) ?? []), key]);
    for (const [json, keys] of groups) {
      const figure = JSON.parse(json) as SavedArmy["figures"][number][string]["figure"];
      const found = await asset(figure.asset);
      if (!found) continue;
      dispatch({ type: "unit/figure", id: unitId, keys, figure, bands: found.figure?.bands }, owner);
    }
  }
}

/** Download an army as a file, with its figures, to pass on or keep. */
export async function exportArmy(army: SavedArmy): Promise<string> {
  const { encodeAsset } = await import("../assets/codec");
  const assets: Record<string, string> = {};
  for (const id of armyAssets(army)) {
    const a = await asset(id);
    if (a) assets[id] = toBase64(await encodeAsset(a));
  }
  const file: ArmyFile = { ...army, attachments: { assets } };
  return saveJson(safeFileName(army.name, "army", ".army.json"), file);
}

/** Download a 40k army as Yellowscribe army data (#75), for TTS army tools; returns the file name. */
export function exportYellowscribe(army: SavedArmy): string {
  return saveJson(safeFileName(army.name, "army", ".yellowscribe.json"), toYellowscribe(army.roster));
}

/** Read an army file onto the shelf; its figures go into this device's cache. */
export async function importArmyFile(file: File): Promise<SavedArmy | string> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return t("That file isn't an Open Battle army.");
  }
  // Yellowscribe army data, which TTS players carry about, goes on the shelf as the list it is (UX 488).
  if (isYellowscribe(data)) {
    const roster = await parseRosterFile(file.name, new TextEncoder().encode(JSON.stringify(data)));
    if (!roster.units.length) return roster.warnings.join(" ") || t("No units found in that list.");
    const army: SavedArmy = {
      format: ARMY_FORMAT,
      id: crypto.randomUUID(),
      name: roster.name,
      system: DEFAULT_SYSTEM,
      savedAt: Date.now(),
      roster,
      figures: {},
    };
    useShelf.getState().put(army);
    return army;
  }
  const army = readArmy(data);
  if (!army) return t("That file isn't an Open Battle army.");
  const attached = (data as ArmyFile).attachments?.assets ?? {};
  if (Object.keys(attached).length) {
    const { decodeAsset } = await import("../assets/codec");
    for (const [id, b64] of Object.entries(attached)) {
      if (!/^[0-9a-f]{64}$/.test(id) || useAssets.getState().assets[id]) continue;
      try {
        const a = { ...(await decodeAsset(fromBase64(b64))), id };
        useAssets.getState().addAsset(a);
        void putCached(a);
      } catch {
        // A damaged figure: those models show their plain stand-ins.
      }
    }
  }
  useShelf.getState().put(army);
  return army;
}
