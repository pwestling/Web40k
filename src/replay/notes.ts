import { create } from "zustand";
import type { GameRecord } from "../core";
import { gameId } from "../campaign/book";
import { idbStore } from "../packages/idb";
import { say } from "../talk/talk";

/**
 * Annotated replays (roadmap #30): notes pinned to moments of a replay, each
 * with a few words and marks on the table (arrows, areas and pins, drawn with
 * the table-talk tools). They're kept on this device by game, travel inside
 * the replay file, and in a review room (review.ts) go to everyone watching.
 */

type Point = { x: number; y: number };

export type NoteMark =
  | { kind: "arrow"; from: Point; to: Point }
  | { kind: "area"; at: Point; radius: number }
  | { kind: "pin"; at: Point };

export interface ReplayNote {
  id: string;
  /** The moment: the log event it's pinned after. */
  seq: number;
  /** Who wrote it, by name, and their colour. */
  by: string;
  color: string;
  text: string;
  marks: NoteMark[];
  /** When it was written (ms). */
  at: number;
}

/** A note being written at a moment, before it's saved. */
export interface NoteDraft {
  seq: number;
  text: string;
  marks: NoteMark[];
  /** Editing a saved note, by id. */
  id?: string;
}

const MAX_TEXT = 1000;
const MAX_MARKS = 24;
const MAX_NOTES = 500;

interface Notes {
  /** The game the notes are for. */
  game: string | null;
  notes: ReplayNote[];
  draft: NoteDraft | null;
  /** Called with each change made here, so a review room can pass it on. */
  onChange: ((change: { put: ReplayNote } | { remove: string }) => void) | null;
}

export const useNotes = create<Notes>(() => ({ game: null, notes: [], draft: null, onChange: null }));

const db = idbStore<{ id: string; notes: ReplayNote[] }>("open-battle-notes", "notes");

/** Notes a replay file brought, by game, until that game's notes are opened. */
const carried = new Map<string, ReplayNote[]>();

export function carryNotes(record: GameRecord, notes: ReplayNote[]): void {
  const id = gameId(record);
  if (id && notes.length) carried.set(id, notes);
}

/** Open a game's notes: this device's, joined with any its replay file carried. */
export async function loadNotes(record: GameRecord): Promise<void> {
  const id = gameId(record);
  const brought = (id && carried.get(id)) || [];
  if (id) carried.delete(id);
  useNotes.setState({ game: id, notes: brought, draft: null });
  if (!id) return;
  const saved = (await db.get(id))?.notes ?? [];
  if (useNotes.getState().game !== id) return;
  useNotes.setState((s) => ({ notes: joinNotes(saved, s.notes) }));
  if (brought.length) persist();
}

function persist(): void {
  const { game, notes } = useNotes.getState();
  if (game) void db.put({ id: game, notes });
}

/** Two lists of notes as one: by id, the later-written copy of each. */
export function joinNotes(a: ReplayNote[], b: ReplayNote[]): ReplayNote[] {
  const byId = new Map<string, ReplayNote>();
  for (const n of [...a, ...b]) {
    const was = byId.get(n.id);
    if (!was || n.at >= was.at) byId.set(n.id, n);
  }
  return [...byId.values()].sort((x, y) => x.seq - y.seq || x.at - y.at).slice(0, MAX_NOTES);
}

/** Add or change a note, here (and for the room, when there is one). */
export function putNote(note: ReplayNote, fromPeer = false): void {
  useNotes.setState((s) => ({ notes: joinNotes(s.notes, [note]) }));
  persist();
  if (!fromPeer) useNotes.getState().onChange?.({ put: note });
}

export function removeNote(id: string, fromPeer = false): void {
  useNotes.setState((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  persist();
  if (!fromPeer) useNotes.getState().onChange?.({ remove: id });
}

/** Start a note at a moment (or go on with a saved one). */
export function startDraft(seq: number, note?: ReplayNote): void {
  useNotes.setState({
    draft: note
      ? { seq: note.seq, text: note.text, marks: note.marks, id: note.id }
      : { seq, text: "", marks: [] },
  });
}

/** Save the draft as a note by this viewer. */
export function saveDraft(by: string, color: string): void {
  const draft = useNotes.getState().draft;
  if (!draft) return;
  useNotes.setState({ draft: null });
  if (!draft.text.trim() && !draft.marks.length) {
    if (draft.id) removeNote(draft.id);
    return;
  }
  putNote({
    id: draft.id ?? crypto.randomUUID().slice(0, 12),
    seq: draft.seq,
    by,
    color,
    text: draft.text.trim().slice(0, MAX_TEXT),
    marks: draft.marks.slice(0, MAX_MARKS),
    at: Date.now(),
  });
}

/**
 * The table-talk tools draw into the note being written, when there is one;
 * otherwise they're table talk as usual. A ping becomes a pin.
 */
export function talkOrNote(item: Parameters<typeof say>[0]): void {
  const draft = useNotes.getState().draft;
  if (!draft || item.kind === "chat" || item.kind === "react") return say(item);
  const mark: NoteMark =
    item.kind === "arrow"
      ? { kind: "arrow", from: item.from, to: item.to }
      : item.kind === "area"
        ? { kind: "area", at: item.at, radius: item.radius }
        : { kind: "pin", at: item.at };
  useNotes.setState({ draft: { ...draft, marks: [...draft.marks, mark].slice(0, MAX_MARKS) } });
}

const point = (p: unknown): p is Point =>
  !!p &&
  typeof p === "object" &&
  Number.isFinite((p as Point).x) &&
  Number.isFinite((p as Point).y) &&
  Math.abs((p as Point).x) < 500 &&
  Math.abs((p as Point).y) < 500;

function cleanMark(m: unknown): NoteMark | null {
  const k = m as Record<string, unknown> | null;
  if (!k) return null;
  if (k.kind === "arrow" && point(k.from) && point(k.to)) return { kind: "arrow", from: k.from, to: k.to };
  if (k.kind === "area" && point(k.at) && typeof k.radius === "number" && k.radius > 0 && k.radius < 200)
    return { kind: "area", at: k.at, radius: k.radius };
  if (k.kind === "pin" && point(k.at)) return { kind: "pin", at: k.at };
  return null;
}

/** A note from a file or a peer, if it's well formed. */
export function cleanNote(n: unknown): ReplayNote | null {
  const x = n as Partial<ReplayNote> | null;
  if (
    !x ||
    typeof x.id !== "string" ||
    x.id.length > 40 ||
    !Number.isInteger(x.seq) ||
    typeof x.by !== "string" ||
    typeof x.color !== "string" ||
    !/^#[0-9a-f]{3,8}$/i.test(x.color) ||
    typeof x.text !== "string" ||
    !Array.isArray(x.marks)
  )
    return null;
  return {
    id: x.id,
    seq: x.seq!,
    by: x.by.slice(0, 40),
    color: x.color,
    text: x.text.slice(0, MAX_TEXT),
    marks: x.marks.slice(0, MAX_MARKS).flatMap((m) => cleanMark(m) ?? []),
    at: Number.isFinite(x.at) ? x.at! : 0,
  };
}

export function cleanNotes(list: unknown): ReplayNote[] {
  return Array.isArray(list) ? list.slice(0, MAX_NOTES).flatMap((n) => cleanNote(n) ?? []) : [];
}
