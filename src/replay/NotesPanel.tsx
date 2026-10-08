import { useEffect, useMemo, useState } from "react";
import { gameId } from "../campaign/book";
import { useStore } from "../store";
import { myName, setMyName, useTalk, who } from "../talk/talk";
import { chapters, type Chapter } from "./chapters";
import { loadNotes, removeNote, saveDraft, startDraft, useNotes, type ReplayNote } from "./notes";
import { followLeader, startReview, takeLead, useReview, useReviewRoom } from "./review";

/** Whether notes can be written here: a replay, or a review room. */
export function useAnnotating(): boolean {
  return useStore((s) => (s.session === null && s.role === "spectator") || s.review);
}

/** This viewer's name and colour on the notes they write. */
function author(): { name: string; color: string } {
  const self = useStore.getState().session?.selfId ?? "local";
  return { name: myName() || "A viewer", color: who(self, myName()).color };
}

/**
 * Beside a replay: its chapters (each side's turn, with what stood out and
 * the round's card), the notes at this moment and the means to add one, and
 * in a review room who is leading.
 */
export function NotesPanel() {
  useReviewRoom();
  const annotating = useAnnotating();
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const setScrub = useStore((s) => s.setScrub);
  const review = useStore((s) => s.review);
  const { notes, draft, game } = useNotes();
  const [tab, setTab] = useState<"notes" | "chapters">("notes");
  const [open, setOpen] = useState(true);
  const id = gameId(record);
  useEffect(() => {
    if (annotating && id && id !== useNotes.getState().game) void loadNotes(record);
  }, [annotating, id, record]);
  const list = useMemo(() => (annotating ? chapters(record) : []), [annotating, record]);
  if (!annotating || game !== id) return null;
  const pos = scrub ?? record.events.at(-1)?.seq ?? 0;
  const here = notes.filter((n) => n.seq === pos);
  const chapterOf = (seq: number) => list.findLast((c) => c.seq <= seq);
  const current = chapterOf(pos);
  if (!open)
    return (
      <button className="notes-open" onClick={() => setOpen(true)}>
        ✎ Notes{notes.length ? ` (${notes.length})` : ""} and chapters
      </button>
    );
  return (
    <div className="panel replay-notes" aria-label="Notes and chapters">
      <div className="row spread">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "notes"}
            className={tab === "notes" ? "on" : ""}
            onClick={() => setTab("notes")}
          >
            Notes{notes.length ? ` (${notes.length})` : ""}
          </button>
          <button
            role="tab"
            aria-selected={tab === "chapters"}
            className={tab === "chapters" ? "on" : ""}
            onClick={() => setTab("chapters")}
          >
            Chapters
          </button>
        </div>
        <button
          className="quiet"
          title="Hide"
          aria-label="Hide notes and chapters"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      {review ? <ReviewBar /> : <WatchTogether />}
      {tab === "chapters" ? (
        <ol className="chapters">
          {list.map((c) => (
            <ChapterRow
              key={c.seq}
              chapter={c}
              current={c === current}
              notes={notes.filter((n) => chapterOf(n.seq) === c).length}
              go={() => setScrub(c.seq)}
            />
          ))}
        </ol>
      ) : (
        <>
          {current && <p className="muted small">{current.title}</p>}
          {here.map((n) => (
            <NoteView key={n.id} note={n} />
          ))}
          {draft ? (
            <Draft />
          ) : (
            <button className="small" onClick={() => startDraft(pos)}>
              ✎ Add a note at this moment
            </button>
          )}
          {notes.length > 0 && (
            <ol className="note-list">
              {notes.map((n) => (
                <li key={n.id} className={n.seq === pos ? "on" : undefined}>
                  <button className="link" onClick={() => setScrub(n.seq)}>
                    <span className="muted">{chapterOf(n.seq)?.title ?? "Setup"}:</span>{" "}
                    {n.text || `${n.marks.length} mark${n.marks.length === 1 ? "" : "s"}`}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function ChapterRow({
  chapter: c,
  current,
  notes,
  go,
}: {
  chapter: Chapter;
  current: boolean;
  notes: number;
  go: () => void;
}) {
  return (
    <li className={current ? "on" : undefined}>
      <button className="link" onClick={go}>
        <strong>{c.title}</strong>
      </button>{" "}
      <span className="muted small">
        {c.actions} action{c.actions === 1 ? "" : "s"}
        {notes ? ` · ✎ ${notes}` : ""}
      </span>
      {c.highlights.length > 0 && <div className="small">{c.highlights.join(" · ")}</div>}
      {c.roundCard && (
        <div className="muted small">
          End of round {c.roundCard.round}:{" "}
          {c.roundCard.players
            .map((p) => `${p.name} ${p.vp} VP${p.modelsLost ? `, lost ${p.modelsLost}` : ""}`)
            .join(" · ")}
        </div>
      )}
    </li>
  );
}

function NoteView({ note }: { note: ReplayNote }) {
  return (
    <div className="note" style={{ borderColor: note.color }}>
      <strong style={{ color: note.color }}>{note.by}</strong>
      {note.text && <p>{note.text}</p>}
      {note.marks.length > 0 && (
        <span className="muted small">
          {note.marks.length} mark{note.marks.length === 1 ? "" : "s"} on the table
        </span>
      )}
      <div className="row">
        <button className="small link" onClick={() => startDraft(note.seq, note)}>
          Edit
        </button>
        <button className="small link" onClick={() => removeNote(note.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

const TOOLS = [
  { id: "arrow", label: "↗ Arrow" },
  { id: "area", label: "◯ Area" },
  { id: "ping", label: "📍 Pin" },
] as const;

function Draft() {
  const draft = useNotes((s) => s.draft)!;
  const tool = useTalk((s) => s.tool);
  const [name, setName] = useState(() => myName() ?? "");
  const set = (patch: Partial<typeof draft>) => useNotes.setState({ draft: { ...draft, ...patch } });
  const save = () => {
    if (name.trim() && name.trim() !== myName()) setMyName(name.trim());
    useTalk.setState({ tool: null });
    const a = author();
    saveDraft(a.name, a.color);
  };
  return (
    <form
      className="note-draft"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <textarea
        aria-label="Note"
        rows={3}
        autoFocus
        placeholder="What happened here, or what should have…"
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      <div className="row wrap">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`small${tool === t.id ? " on" : ""}`}
            title="Draw on the table for this note"
            onClick={() => useTalk.setState({ tool: tool === t.id ? null : t.id })}
          >
            {t.label}
          </button>
        ))}
        {draft.marks.length > 0 && (
          <button
            type="button"
            className="small quiet"
            onClick={() => set({ marks: draft.marks.slice(0, -1) })}
          >
            Undo mark ({draft.marks.length})
          </button>
        )}
      </div>
      {!myName() && (
        <input
          aria-label="Your name"
          placeholder="Your name, on the note"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <div className="row">
        <button className="small primary">Save the note</button>
        <button
          type="button"
          className="small"
          onClick={() => {
            useTalk.setState({ tool: null });
            useNotes.setState({ draft: null });
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** In a replay: open a review room so others (a coach, the opponent) watch and annotate it with you. */
function WatchTogether() {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        className="small"
        onClick={() => setAsking(true)}
        title="Invite others to watch this replay with you"
      >
        Watch together…
      </button>
    );
  return (
    <div className="watch-together">
      <p className="small">
        Opens this replay online. Anyone with the link watches along with you, and can add notes that everyone
        sees, like a coach going over the game.
      </p>
      <div className="row">
        <button className="small primary" onClick={() => startReview()}>
          Open it and get a link
        </button>
        <button className="small" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewBar() {
  const { leader, leaderName, following } = useReview();
  const self = useStore((s) => s.session?.selfId);
  const peers = useStore((s) => s.net?.peers.length ?? 0);
  const [copied, setCopied] = useState(false);
  const leading = leader === self;
  const copy = () => {
    void navigator.clipboard?.writeText(location.href).then(() => setCopied(true));
  };
  return (
    <div className="review-bar">
      <p className="small">
        <strong>Watching together</strong> ·{" "}
        {peers ? `${peers} other${peers === 1 ? "" : "s"} here` : "nobody else yet"}
        {" · "}
        {leading
          ? "you lead: everyone following sees what you scrub to"
          : following
            ? `following ${leaderName || "the leader"}`
            : "on your own"}
      </p>
      <div className="row wrap">
        {!leading && !following && leader && (
          <button className="small primary" onClick={followLeader}>
            Follow {leaderName || "the leader"} again
          </button>
        )}
        {!leading && (
          <button className="small" onClick={takeLead}>
            Lead
          </button>
        )}
        <button className="small" onClick={copy}>
          {copied ? "Link copied" : "Copy the invite link"}
        </button>
      </div>
    </div>
  );
}

/** Over the table at a moment with notes: what they say, big enough to read from the couch. */
export function NoteCaption() {
  const annotating = useAnnotating();
  const scrub = useStore((s) => s.scrub);
  const notes = useNotes((s) => s.notes);
  const draft = useNotes((s) => s.draft);
  if (!annotating || scrub === null || draft) return null;
  const here = notes.filter((n) => n.seq === scrub && n.text);
  if (!here.length) return null;
  return (
    <div className="note-caption" role="status">
      {here.map((n) => (
        <p key={n.id} style={{ borderColor: n.color }}>
          <strong style={{ color: n.color }}>{n.by}:</strong> {n.text}
        </p>
      ))}
    </div>
  );
}
