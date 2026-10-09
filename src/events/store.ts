import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { board } from "../opentables/board";
import { myKey, signAsMe, signedBy, useCard } from "../player/card";
import { useRankedResults } from "../ranked/store";
import { useRunsEvents } from "./open";
import type { RankedResult } from "../core/ranked";
import {
  authorOf,
  docText,
  eventId,
  nextPairings,
  readDoc,
  roundIn,
  type EntryDoc,
  type EventDoc,
  type EventItem,
  type HandResult,
  type SignedDoc,
} from "./event";

/**
 * Online events (#67) on this device: every event and entry read off the
 * board (each checked against its author's signature), kept so an event's page
 * and its games work after a reload; the organiser's own running of their
 * events (taking entries, pairing each round once the last is in, the final
 * standings); and a player's entry.
 */

const KEY = "open-battle:events";
/** The events this device organises: it runs them while it's open. */
const MINE = "open-battle:events-mine";

interface EventsState {
  events: Record<string, SignedDoc & { doc: EventDoc }>;
  /** Entries by event, then by player key. */
  entries: Record<string, Record<string, SignedDoc & { doc: EntryDoc }>>;
  mine: string[];
  /** The board has answered at least once. */
  loaded: boolean;
}

function loadKept(): Pick<EventsState, "events" | "entries" | "mine"> {
  const empty = { events: {}, entries: {}, mine: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<EventsState> | null;
    const mine = JSON.parse(localStorage.getItem(MINE) ?? "[]") as unknown;
    return {
      events: raw?.events ?? {},
      entries: raw?.entries ?? {},
      mine: Array.isArray(mine) ? mine.filter((m): m is string => typeof m === "string") : [],
    };
  } catch {
    return empty;
  }
}

const useEvents = create<EventsState>(() => ({ ...loadKept(), loaded: false }));

useEvents.subscribe((s, prev) => {
  try {
    if (s.events !== prev.events || s.entries !== prev.entries) {
      // Only recent events are kept: an event a week old has long finished.
      const recent = Object.fromEntries(
        Object.entries(s.events).filter(([, e]) => e.doc.start > Date.now() - 7 * 24 * 3600_000),
      );
      const entries = Object.fromEntries(Object.entries(s.entries).filter(([id]) => recent[id]));
      localStorage.setItem(KEY, JSON.stringify({ events: recent, entries }));
    }
    if (s.mine !== prev.mine) localStorage.setItem(MINE, JSON.stringify(s.mine));
  } catch {
    // Storage full or blocked: the board has them.
  }
});

/** Docs from the board (or this device), each checked against its author's signature; the newest of each kept. */
async function takeDocs(raw: unknown[]): Promise<void> {
  const fresh: (SignedDoc & { doc: EventItem })[] = [];
  await Promise.all(
    raw.map(async (r) => {
      const s = r as Partial<SignedDoc> | null;
      const doc = readDoc(s?.doc);
      if (!doc || typeof s?.sig !== "string") return;
      const { events, entries } = useEvents.getState();
      const was = doc.kind === "event" ? events[doc.id] : entries[doc.event]?.[doc.key];
      if (was && was.doc.at >= doc.at) return;
      if (await signedBy(docText(s.doc as EventItem), s.sig, authorOf(doc))) fresh.push({ doc, sig: s.sig });
    }),
  );
  if (!fresh.length) return;
  useEvents.setState((st) => {
    const events = { ...st.events };
    const entries = { ...st.entries };
    for (const f of fresh) {
      if (f.doc.kind === "event") {
        if (!events[f.doc.id] || events[f.doc.id]!.doc.at < f.doc.at)
          events[f.doc.id] = f as SignedDoc & { doc: EventDoc };
      } else {
        const of = { ...entries[f.doc.event] };
        if (!of[f.doc.key] || of[f.doc.key]!.doc.at < f.doc.at)
          of[f.doc.key] = f as SignedDoc & { doc: EntryDoc };
        entries[f.doc.event] = of;
      }
    }
    return { events, entries };
  });
}

/** Sign a doc with this device's player key and put it on the board. */
async function publish(doc: EventItem): Promise<void> {
  const signed: SignedDoc = { doc, sig: await signAsMe(docText(doc)) };
  await takeDocs([signed]);
  await (await board())?.publishDoc(signed).catch(() => {});
}

let watchers = 0;
let stop: (() => void) | null = null;
let fastStop: (() => void) | null = null;
let fast = 0;

/** Read the board's events while mounted; `often` while a round may be under way. */
export function useEventDocs(often = false): EventsState {
  useEffect(() => {
    if (watchers++ === 0)
      void board().then((b) => {
        if (!b || watchers === 0 || stop) return;
        stop = b.watchDocs(
          (raw) => void takeDocs(raw).then(() => useEvents.setState({ loaded: true })),
          30_000,
        );
      });
    return () => {
      if (--watchers === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!often) return;
    if (fast++ === 0)
      void board().then((b) => {
        if (!b || fast === 0 || fastStop) return;
        fastStop = b.watchDocs((raw) => void takeDocs(raw), 5_000);
      });
    return () => {
      if (--fast === 0) {
        fastStop?.();
        fastStop = null;
      }
    };
  }, [often]);
  return useEvents();
}

/** The results every device counts for events: both players signed them. */
export function useEventResults(): RankedResult[] {
  const results = useRankedResults();
  return useMemo(() => Object.values(results).map((r) => r.result), [results]);
}

interface NewEvent {
  name: string;
  system: string;
  game: string;
  points: number | null;
  rounds: number;
  start: number;
  missions: EventDoc["missions"];
  clock: number | null;
  live: boolean;
}

/** Post a new event, organised from this device. */
export async function postEvent(e: NewEvent): Promise<string> {
  const organiser = await myKey();
  const id = eventId(organiser, crypto.randomUUID().replace(/-/g, ""));
  const doc: EventDoc = {
    kind: "event",
    v: 1,
    id,
    organiser,
    ...e,
    entrants: [],
    dropped: [],
    pairings: [],
    hand: [],
    closed: false,
    done: false,
    at: Date.now(),
  };
  useEvents.setState((s) => ({ mine: [...new Set([...s.mine, id])] }));
  useRunsEvents.setState({ on: true });
  await publish(doc);
  return id;
}

/** Change an event this device organises, and publish it. */
async function change(id: string, edit: (doc: EventDoc) => EventDoc | null): Promise<void> {
  const was = useEvents.getState().events[id]?.doc;
  if (!was || was.organiser !== (await myKey())) return;
  const next = edit(was);
  if (!next) return;
  await publish({ ...next, at: Math.max(Date.now(), was.at + 1) });
}

/** Close registration now, with whoever has entered, and pair round one. */
export const startEvent = (id: string) => {
  const entries = Object.values(useEvents.getState().entries[id] ?? {}).map((e) => e.doc);
  return change(id, (doc) => (doc.closed ? null : advance(doc, [], { entries, force: true })));
};

/** A player out of the event (or back in): not paired again, their results stand. */
export const setDropped = (id: string, key: string, out: boolean) =>
  change(id, (doc) => ({
    ...doc,
    dropped: out ? [...new Set([...doc.dropped, key])] : doc.dropped.filter((k) => k !== key),
  }));

/** The organiser's result for a pairing (played off the app, or a ruling on a dispute); null clears it. */
export const setHandResult = (
  id: string,
  round: number,
  table: number,
  vp: [number, number] | null,
  note = "",
) =>
  change(id, (doc) => {
    const hand: HandResult[] = doc.hand.filter((h) => h.round !== round || h.table !== table);
    if (vp) hand.push({ round, table, vp, ...(note.trim() ? { note: note.trim().slice(0, 140) } : {}) });
    return { ...doc, hand };
  });

/** Pair the next round now (it pairs itself once every result is in). */
export const pairNext = (id: string, results: RankedResult[]) =>
  change(id, (doc) => (doc.closed ? advance(doc, results, { force: true }) : null));

/**
 * What the organiser's device does with an event as things come in: takes
 * entries until it starts, pairs each round once the one before is in (or at
 * once, `force`), and says when it's done. Null when nothing changes.
 */
export function advance(
  doc: EventDoc,
  results: RankedResult[],
  {
    entries = [],
    now = Date.now(),
    force = false,
  }: { entries?: EntryDoc[]; now?: number; force?: boolean } = {},
): EventDoc | null {
  if (doc.done) return null;
  if (!doc.closed) {
    // Entries as they come: the army is locked at the first acceptance; withdrawing takes a player out.
    let entrants = doc.entrants;
    for (const e of entries) {
      const there = entrants.find((x) => x.key === e.key);
      if (e.out) {
        if (there) entrants = entrants.filter((x) => x.key !== e.key);
      } else if (!there)
        entrants = [...entrants, { key: e.key, name: e.name, army: e.army, armyName: e.armyName }];
    }
    const changed = entrants !== doc.entrants;
    // Start time: registration closes and round one is paired.
    if ((force || now >= doc.start) && entrants.length >= 2) {
      const open = { ...doc, entrants, closed: true };
      return { ...open, pairings: [nextPairings(open, results)] };
    }
    return changed ? { ...doc, entrants } : null;
  }
  const round = doc.pairings.length;
  if (round === 0) return { ...doc, pairings: [nextPairings(doc, results)] };
  if (!force && !roundIn(doc, round, results)) return null;
  if (round >= doc.rounds) return roundIn(doc, round, results) ? { ...doc, done: true } : null;
  return { ...doc, pairings: [...doc.pairings, nextPairings(doc, results)] };
}

/** Changes on their way to the board, by event: one at a time. */
const busy = new Set<string>();

/** Run this device's events: entries, pairings and the end (mounted with the app while there are any). */
/** How often a running event's organiser device republishes it, as a sign it's still there. */
const HEARTBEAT_MS = 5 * 60_000;

export function useRunMyEvents(): void {
  const mine = useEvents((s) => s.mine);
  const events = useEvents((s) => s.events);
  const entries = useEvents((s) => s.entries);
  const results = useEventResults();
  const key = useCard((s) => s.key);
  useEffect(() => void myKey(), []);
  useEffect(() => {
    for (const id of mine) {
      const doc = events[id]?.doc;
      if (!doc || doc.organiser !== key) continue;
      if (busy.has(id)) continue;
      const next = advance(doc, results, { entries: Object.values(entries[id] ?? {}).map((e) => e.doc) });
      if (!next) continue;
      busy.add(id);
      void change(id, () => next).finally(() => busy.delete(id));
    }
  }, [mine, events, entries, results, key]);
  // The start time passes with nothing else happening: look again each minute. And say this device is
  // still here every few minutes, so players can tell when it has gone (UX 458).
  useEffect(() => {
    if (!mine.length) return;
    const timer = setInterval(() => {
      useEvents.setState((s) => ({ events: { ...s.events } }));
      const { events: now } = useEvents.getState();
      for (const id of useEvents.getState().mine) {
        const doc = now[id]?.doc;
        if (!doc || doc.done || busy.has(id) || Date.now() - doc.at < HEARTBEAT_MS) continue;
        busy.add(id);
        void change(id, (d) => ({ ...d })).finally(() => busy.delete(id));
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [mine.length]);
}

/** Enter an event with a shelf army (or change the army before it starts), or withdraw (`out`). */
export async function enter(event: string, army: { hash: string; name: string }, out = false): Promise<void> {
  const key = await myKey();
  const name = useCard.getState().name.trim() || localStorage.getItem("open-battle:name") || "Player";
  await publish({
    kind: "entry",
    v: 1,
    event,
    key,
    name: name.slice(0, 32),
    army: army.hash,
    armyName: army.name.slice(0, 80),
    ...(out ? { out: true } : {}),
    at: Date.now(),
  });
}
