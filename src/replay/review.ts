import { useEffect } from "react";
import { create } from "zustand";
import type { SideMessage } from "../net/transport";
import { gameId } from "../campaign/book";
import { useStore } from "../store";
import { myName } from "../talk/talk";
import { NET_PARAMS } from "../net/config";
import { cleanNote, cleanNotes, putNote, removeNote, useNotes } from "./notes";

/**
 * A review room (roadmap #30, coach mode): a replay watched together online.
 * Whoever opened it hosts the record (frozen: nothing can be added to it) and
 * leads; everyone else follows the leader's place in the replay, can take
 * the lead, or wander off on their own and follow again. Notes anyone writes
 * go to everyone, and someone joining gets all of them.
 */

interface Review {
  /** The peer everyone follows, and their name. */
  leader: string | null;
  leaderName: string;
  /** The leader's last place. */
  leaderSeq: number | null;
  /** Whether this viewer follows the leader (until they scrub on their own). */
  following: boolean;
}

export const useReview = create<Review>(() => ({
  leader: null,
  leaderName: "",
  leaderSeq: null,
  following: true,
}));

/** True while a scrub comes from following the leader, not this viewer's own hand. */
let applying = false;

function follow(seq: number) {
  applying = true;
  useStore.getState().setScrub(seq);
  applying = false;
}

function sendLead(to?: string) {
  const { session, scrub } = useStore.getState();
  if (!session || scrub === null) return;
  const name = myName();
  session.sendSide({ t: "review/lead", seq: scrub, ...(name ? { name } : {}) }, to);
}

/** Lead the room: everyone following goes where this viewer goes. */
export function takeLead(): void {
  const self = useStore.getState().session?.selfId ?? null;
  useReview.setState({ leader: self, leaderName: myName() ?? "", following: true });
  sendLead();
}

/** Follow the leader again, from where they are now. */
export function followLeader(): void {
  const { leaderSeq } = useReview.getState();
  useReview.setState({ following: true });
  if (leaderSeq !== null) follow(leaderSeq);
}

function receive(message: SideMessage, from: string) {
  const session = useStore.getState().session;
  if (message.t === "review/hello") {
    // Someone ready for the room: the host sends every note, the leader where they are.
    if (useReview.getState().leader === session?.selfId) sendLead(from);
    if (session?.status.role === "host")
      session.sendSide({ t: "review/notes", notes: useNotes.getState().notes }, from);
    return;
  }
  if (message.t === "review/lead") {
    if (!Number.isInteger(message.seq)) return;
    // Someone else took the lead from this viewer: follow them now.
    const self = useStore.getState().session?.selfId;
    if (useReview.getState().leader === self && from !== self) useReview.setState({ following: true });
    useReview.setState({
      leader: from,
      leaderName: typeof message.name === "string" ? message.name.slice(0, 24) : "",
      leaderSeq: message.seq,
    });
    if (useReview.getState().following) follow(message.seq);
  } else if (message.t === "review/note") {
    const note = cleanNote(message.note);
    if (note) putNote(note, true);
  } else if (message.t === "review/unnote") {
    if (typeof message.id === "string") removeNote(message.id, true);
  } else if (message.t === "review/notes") {
    for (const n of cleanNotes(message.notes)) putNote(n, true);
  }
}

/** While this is a review room: follow and lead, and pass notes around. */
export function useReviewRoom(): void {
  const session = useStore((s) => s.session);
  const review = useStore((s) => s.review);
  useEffect(() => {
    if (!session || !review) return;
    const self = session.selfId;
    const hosting = session.status.role === "host";
    useReview.setState({
      leader: hosting ? self : null,
      leaderName: hosting ? (myName() ?? "") : "",
      leaderSeq: null,
      following: !hosting,
    });
    useNotes.setState({
      onChange: (change) =>
        "put" in change
          ? session.sendSide({ t: "review/note", note: change.put })
          : session.sendSide({ t: "review/unnote", id: change.remove }),
    });
    session.listenSide(receive, null, "review");
    // Once this viewer has the record and its own notes for it, ask the room for theirs (and where the
    // leader is): notes sent any earlier would be lost when the record arrives and its notes open.
    let asked = false;
    const hello = () => {
      const { game } = useNotes.getState();
      if (asked || hosting || !game || game !== gameId(useStore.getState().record)) return;
      asked = true;
      session.sendSide({ t: "review/hello" });
    };
    const stopNotes = useNotes.subscribe(hello);
    hello();
    const stop = useStore.subscribe((s, prev) => {
      if (s.scrub === prev.scrub || applying || s.scrub === null) return;
      const r = useReview.getState();
      if (r.leader === self) sendLead();
      else if (r.following) useReview.setState({ following: false });
    });
    return () => {
      stop();
      stopNotes();
      session.listenSide(null, null, "review");
      useNotes.setState({ onChange: null });
    };
  }, [session, review]);
}

/** Start a review room for the replay on screen, and give back its invite link. */
export function startReview(): string {
  const { record, start } = useStore.getState();
  const roomId = crypto.randomUUID().slice(0, 8);
  const params = new URLSearchParams(location.search);
  const q = new URLSearchParams({ room: roomId, review: "1" });
  for (const k of NET_PARAMS) if (params.get(k)) q.set(k, params.get(k)!);
  history.replaceState(null, "", `?${q}`);
  start({ role: "host", mode: "online", roomId, name: myName() ?? "", record, review: true });
  return location.href;
}
