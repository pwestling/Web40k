import { useEffect } from "react";
import { create } from "zustand";
import {
  commitTo,
  resolveLogged,
  sharedRng,
  stateAt,
  type GameRecord,
  type LoggedEvent,
  type PlayerId,
} from "../core";
import { rankedOver, rankedReady } from "../core/ranked";
import { useStore } from "../store";
import { keepSecret, newSeed, sharedSecret } from "./diceSecrets";

/**
 * Shared dice in a ranked game, on each player's device (core/sharedDice.ts):
 * the host keeps its secret seeds and commits, reveals and commits again as
 * battle rounds end; the other player sends a seed for each commitment and,
 * once a seed is revealed, rolls that stretch's events again to check them.
 */

/** What rolling one revealed stretch again found. */
interface StretchCheck {
  /** The reveal's event number. */
  reveal: number;
  /** Events whose dice came out the same. */
  checked: number;
  /** Events whose dice didn't: the host's dice weren't the shared ones. */
  wrong: number[];
  /** Events rolled before every player's seed was in, or by another host: fair to no one in particular. */
  unchecked: number;
  /** Dice rolled at a real table and typed in. */
  typed: number;
}

/**
 * Roll every event between a commitment and its reveal again, with the
 * revealed seed and the other players' seeds as they stood at each event.
 * A rules package's event is checked by the seed its sandbox was given.
 */
export function checkStretch(record: GameRecord, reveal: LoggedEvent): StretchCheck | null {
  if (reveal.event.type !== "dice/reveal") return null;
  const seed = reveal.event.seed;
  const host = reveal.event.player;
  const commit = commitTo(seed);
  const start = record.events.findLast(
    (e) =>
      e.seq < reveal.seq &&
      e.by === host &&
      ((e.event.type === "dice/commit" && e.event.hash === commit) ||
        (e.event.type === "dice/reveal" && e.event.next === commit)),
  );
  if (!start) return null;
  const out: StretchCheck = { reveal: reveal.seq, checked: 0, wrong: [], unchecked: 0, typed: 0 };
  for (const e of record.events) {
    if (e.seq <= start.seq || e.seq >= reveal.seq) continue;
    if (e.event.type === "dice/seed") continue;
    const before = stateAt(record, e.seq - 1);
    const seeds = before.sharedDice?.seeds ?? {};
    const everyone = Object.keys(before.ranked?.keys ?? {}).every((p) => p === host || !!seeds[p]);
    if (!e.intent || (e.host !== undefined && e.host !== host) || !everyone) {
      out.unchecked++;
      continue;
    }
    if (e.told) {
      out.typed++;
      continue;
    }
    const rng = sharedRng(seed, seeds, e.seq);
    if (e.seed !== undefined) {
      if (Math.floor(rng() * 2 ** 32) === e.seed) out.checked++;
      else out.wrong.push(e.seq);
      continue;
    }
    const prefix = { ...record, events: record.events.filter((x) => x.seq < e.seq) };
    const again = resolveLogged(prefix, e.intent, e.by, rng, e.at, before);
    if (again && JSON.stringify(again.event) === JSON.stringify(e.event)) out.checked++;
    else out.wrong.push(e.seq);
  }
  return out;
}

/** Each revealed stretch's check, by reveal event number, as this device found it. */
const useDiceChecks = create<Record<number, StretchCheck>>(() => ({}));

/** What the shared dice say about this game, for the signing screen: "" when nothing is wrong. */
export function diceProblem(
  record: GameRecord,
  self: PlayerId,
): { wrong: number; unchecked: number; open: boolean } {
  const state = stateAt(record);
  let wrong = 0;
  let unchecked = 0;
  for (const e of record.events)
    if (e.event.type === "dice/reveal" && e.event.player !== self) {
      const c = useDiceChecks.getState()[e.seq] ?? checkStretch(record, e);
      if (!c) continue;
      wrong += c.wrong.length;
      unchecked += c.unchecked;
    }
  return { wrong, unchecked, open: !!state.sharedDice && state.sharedDice.by !== self };
}

/**
 * Runs shared dice on this device: as host, commit, then reveal and commit
 * again when a battle round ends (just reveal once the battle is over); as the
 * other player, send a seed for each commitment and check each reveal.
 */
export function SharedDiceKeeper() {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const self = useStore((s) => s.session?.selfId);
  const role = useStore((s) => s.net?.role);
  const dispatch = useStore((s) => s.dispatch);
  const ranked = !!self && rankedReady(game) && !!game.ranked?.keys[self];
  const d = game.sharedDice;
  const over = rankedOver(game);
  // Host: commit, or reveal at a round's end.
  const hostStep =
    !ranked || role !== "host"
      ? null
      : !d
        ? over
          ? null
          : "commit"
        : d.by !== self || !sharedSecret(d.commit)
          ? over
            ? null
            : "commit"
          : over || game.turn.round > d.round
            ? "reveal"
            : null;
  const hostKey = `${hostStep}:${d?.commit ?? ""}`;
  useEffect(() => {
    if (!hostStep || !self) return;
    if (hostStep === "commit") dispatch({ type: "dice/commit", hash: keepSecret(newSeed()) });
    else {
      const seed = sharedSecret(d!.commit)!;
      dispatch({ type: "dice/reveal", seed, ...(over ? {} : { next: keepSecret(newSeed()) }) });
    }
    // Once per commitment and step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostKey]);
  // The other player: a seed for each commitment.
  const owe = ranked && !!d && d.by !== self && !d.seeds[self!];
  useEffect(() => {
    if (owe) dispatch({ type: "dice/seed", seed: newSeed() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owe, d?.commit]);
  // Check each reveal by someone else, once.
  const last = record.events.findLast((e) => e.event.type === "dice/reveal");
  useEffect(() => {
    if (!last || last.event.type !== "dice/reveal" || last.event.player === self) return;
    if (useDiceChecks.getState()[last.seq]) return;
    const c = checkStretch(useStore.getState().record, last);
    if (c) useDiceChecks.setState({ [last.seq]: c });
  }, [last, self]);
  return null;
}
