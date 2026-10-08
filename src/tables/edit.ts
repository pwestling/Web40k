import { create } from "zustand";
import type { GameState, TerrainPiece, Vec2 } from "../core";
import { useStore } from "../store";

/**
 * Editing aids for the terrain editor (#28):
 * - symmetry: every change to a piece is made to its twin through the table
 *   centre too (turned half a turn), so both halves stay the same;
 * - snap: pieces land on the half inch and turn in 15° steps;
 * - a group: Shift-click pieces to move, copy or remove them together.
 */
export const useTableEdit = create<{
  symmetry: boolean;
  snap: boolean;
  group: string[];
  /** The pre-game sightline view: what each deployment zone can see. */
  sightlines: boolean;
}>(() => ({ symmetry: false, snap: false, group: [], sightlines: false }));

const newId = () => `t-${crypto.randomUUID().slice(0, 8)}`;
const TURN = Math.PI;
const near = (a: number, b: number, d: number) => Math.abs(a - b) <= d;
/** Two facings half a turn apart. */
const halfTurnApart = (a: number, b: number) => {
  const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return near(d, Math.PI, 0.05);
};

/** The piece opposite this one through the table centre, if the table has one. */
export function twinOf(terrain: TerrainPiece[], piece: TerrainPiece): TerrainPiece | undefined {
  if (Math.hypot(piece.position.x, piece.position.y) < 0.5) return undefined;
  return terrain.find(
    (t) =>
      t.id !== piece.id &&
      t.name === piece.name &&
      near(t.width, piece.width, 0.05) &&
      near(t.depth, piece.depth, 0.05) &&
      near(t.position.x, -piece.position.x, 0.5) &&
      near(t.position.y, -piece.position.y, 0.5) &&
      halfTurnApart(t.facing, piece.facing),
  );
}

/** The piece's place across the centre: the same piece, a half turn round. */
function opposite(piece: TerrainPiece, id: string): TerrainPiece {
  return {
    ...piece,
    id,
    position: { x: -piece.position.x, y: -piece.position.y },
    facing: piece.facing + TURN,
  };
}

function snapped(piece: TerrainPiece): TerrainPiece {
  if (!useTableEdit.getState().snap) return piece;
  const step = Math.PI / 12;
  return {
    ...piece,
    position: { x: Math.round(piece.position.x * 2) / 2, y: Math.round(piece.position.y * 2) / 2 },
    facing: Math.round(piece.facing / step) * step,
  };
}

const game = (): GameState => useStore.getState().game;
const dispatch: ReturnType<typeof useStore.getState>["dispatch"] = (intent, as) =>
  useStore.getState().dispatch(intent, as);

/** Change pieces (as they were before → as they are now), with their twins when symmetry is on. */
export function updatePieces(changes: { before: TerrainPiece; after: TerrainPiece }[]) {
  const { symmetry } = useTableEdit.getState();
  const terrain = game().terrain;
  const moving = new Set(changes.map((c) => c.before.id));
  for (const { before, after } of changes) {
    const next = snapped(after);
    dispatch({ type: "terrain/update", piece: next });
    if (!symmetry) continue;
    const twin = twinOf(terrain, before);
    // A twin being changed in its own right is left to that change.
    if (twin && !moving.has(twin.id)) dispatch({ type: "terrain/update", piece: opposite(next, twin.id) });
  }
}

export function updatePiece(before: TerrainPiece, patch: Partial<TerrainPiece>) {
  updatePieces([{ before, after: { ...before, ...patch } }]);
}

/** Add a piece (and its twin, with symmetry on); returns the new piece's id. */
export function addPiece(piece: TerrainPiece): string {
  const { symmetry } = useTableEdit.getState();
  // With symmetry on, a new piece starts off the centre line so its twin doesn't sit on it.
  const placed = snapped(
    symmetry && Math.hypot(piece.position.x, piece.position.y) < 0.5
      ? { ...piece, position: { x: piece.position.x, y: piece.position.y + 6 } }
      : piece,
  );
  dispatch({ type: "terrain/add", piece: placed });
  if (symmetry) dispatch({ type: "terrain/add", piece: opposite(placed, newId()) });
  return placed.id;
}

/** Remove pieces (and their twins, with symmetry on). */
export function removePieces(ids: string[]) {
  const { symmetry } = useTableEdit.getState();
  const terrain = game().terrain;
  const gone = new Set<string>();
  for (const id of ids) {
    const piece = terrain.find((t) => t.id === id);
    if (!piece) continue;
    gone.add(id);
    const twin = symmetry ? twinOf(terrain, piece) : undefined;
    if (twin) gone.add(twin.id);
  }
  for (const id of gone) dispatch({ type: "terrain/remove", id });
  useTableEdit.setState((s) => ({ group: s.group.filter((g) => !gone.has(g)) }));
  const { selectedTerrain, set } = useStore.getState();
  if (selectedTerrain && gone.has(selectedTerrain)) set({ selectedTerrain: null });
}

/** Copy pieces a little way off (twins too, with symmetry on); the copies become the group. */
export function duplicatePieces(ids: string[], offset: Vec2 = { x: 3, y: 3 }): string[] {
  const terrain = game().terrain;
  const copies: string[] = [];
  for (const id of ids) {
    const piece = terrain.find((t) => t.id === id);
    if (!piece) continue;
    const copy = {
      ...piece,
      id: newId(),
      position: { x: piece.position.x + offset.x, y: piece.position.y + offset.y },
    };
    copies.push(addPiece(copy));
  }
  useTableEdit.setState({ group: copies.length > 1 ? copies : [] });
  if (copies[0]) useStore.getState().set({ selectedTerrain: copies[0] });
  return copies;
}

/** Give a piece a twin across the centre, if it has none. */
export function mirrorPiece(piece: TerrainPiece) {
  if (twinOf(game().terrain, piece) || atCentre(piece)) return;
  dispatch({ type: "terrain/add", piece: opposite(piece, newId()) });
}

/** A piece at the table centre is its own twin. */
export const atCentre = (piece: TerrainPiece) => Math.hypot(piece.position.x, piece.position.y) < 0.5;

/** How many pieces have no twin: 0 means the table is the same from both sides. */
export function unpaired(terrain: TerrainPiece[]): TerrainPiece[] {
  return terrain.filter((t) => !atCentre(t) && !twinOf(terrain, t));
}

/**
 * Shift-click: a piece in or out of the group. Starting a group takes the
 * piece already selected along with it, so click one, Shift-click another
 * groups both.
 */
export function toggleGroup(id: string, selected?: string | null) {
  useTableEdit.setState((s) => {
    if (s.group.includes(id)) return { group: s.group.filter((g) => g !== id) };
    const start = !s.group.length && selected && selected !== id ? [selected] : s.group;
    return { group: [...start, id] };
  });
}
