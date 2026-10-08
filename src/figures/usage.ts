import { armyAssets, useShelf } from "../packages/shelf";
import { loadSavedGame, useStore } from "../store";
import { layoutAssets, useTables } from "../tables/library";

/** Where a model is used on this device. */
export interface Usage {
  armies: string[];
  tables: string[];
  /** On the table now, or in the game saved to resume. */
  game: boolean;
}

const HASH = /[0-9a-f]{64}/g;

/** Figure ids mentioned anywhere in a stored game (its record names them in figure and terrain events). */
function idsIn(value: unknown): Set<string> {
  try {
    return new Set(JSON.stringify(value).match(HASH) ?? []);
  } catch {
    return new Set();
  }
}

/** Mail games keep their own record on this device (src/mail/store.ts). */
function mailRecords(): unknown[] {
  try {
    const ids = JSON.parse(localStorage.getItem("open-battle:mail-games") ?? "[]") as string[];
    return ids.map((id) => localStorage.getItem(`open-battle:mail:${id}`));
  } catch {
    return [];
  }
}

/** Where each model is used: saved armies, saved tables, and games in progress. Load the shelf and tables first. */
export function usage(): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  const of = (id: string) => (out[id] ??= { armies: [], tables: [], game: false });
  for (const army of Object.values(useShelf.getState().armies))
    for (const id of armyAssets(army)) of(id).armies.push(army.name);
  for (const table of Object.values(useTables.getState().tables))
    for (const id of layoutAssets(table.layout)) of(id).tables.push(table.name);
  const { game } = useStore.getState();
  const playing = new Set([
    ...Object.values(game.models).flatMap((m) => (m.figure ? [m.figure.asset] : [])),
    ...game.terrain.flatMap((t) => (t.mesh ? [t.mesh.asset] : [])),
    ...idsIn(loadSavedGame()?.record),
    ...mailRecords().flatMap((r) => [...idsIn(r)]),
  ]);
  for (const id of playing) of(id).game = true;
  return out;
}

export const unused = (u: Usage | undefined) => !u || (!u.armies.length && !u.tables.length && !u.game);
