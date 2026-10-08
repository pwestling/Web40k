import { useEffect, useMemo, useState } from "react";
import { VIEWER } from "../viewer/flag";
import { gameId } from "../campaign/book";
import { useStore } from "../store";
import { myName, setMyName, useTalk, who } from "../talk/talk";
import { chapters, type Chapter } from "./chapters";
import { loadNotes, ownNote, removeNote, saveDraft, startDraft, useNotes, type ReplayNote } from "./notes";
import { followLeader, goTo, startReview, takeLead, useReview, useReviewRoom } from "./review";
import { t, tn } from "../i18n";

/** Whether notes can be written here: a replay, or a review room. */
export function useAnnotating(): boolean {
  return useStore((s) => (s.session === null && s.role === "spectator") || s.review);
}

/** This viewer's name and colour on the notes they write. */
function author(): { name: string; color: string } {
  const self = useStore.getState().session?.selfId ?? "local";
  return { name: myName() || t("A viewer"), color: who(self, myName()).color };
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
  const review = useStore((s) => s.review);
  const { notes, draft, game } = useNotes();
  const notesIn = useReview((s) => s.notesIn);
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
        {notes.length ? t("✎ Notes ({n}) and chapters", { n: notes.length }) : t("✎ Notes and chapters")}
      </button>
    );
  return (
    <div className="panel replay-notes" aria-label={t("Notes and chapters")}>
      <div className="row spread">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "notes"}
            className={tab === "notes" ? "on" : ""}
            onClick={() => setTab("notes")}
          >
            {notes.length ? t("Notes ({n})", { n: notes.length }) : t("Notes")}
          </button>
          <button
            role="tab"
            aria-selected={tab === "chapters"}
            className={tab === "chapters" ? "on" : ""}
            onClick={() => setTab("chapters")}
          >
            {t("Chapters")}
          </button>
        </div>
        <button
          className="quiet"
          title={t("Hide")}
          aria-label={t("Hide notes and chapters")}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      {review ? <ReviewBar /> : VIEWER ? null : <WatchTogether />}
      {tab === "chapters" ? (
        <ol className="chapters">
          {list.map((c) => (
            <ChapterRow
              key={c.seq}
              chapter={c}
              current={c === current}
              notes={notes.filter((n) => chapterOf(n.seq) === c).length}
              go={() => goTo(c.seq)}
            />
          ))}
        </ol>
      ) : (
        <>
          {current && <p className="muted small">{current.title}</p>}
          {review && !notesIn && <p className="muted small">{t("Getting the notes…")}</p>}
          {here.map((n) => (
            <NoteView key={n.id} note={n} />
          ))}
          {draft ? (
            <Draft />
          ) : (
            <button className="small" onClick={() => startDraft(pos)}>
              {t("✎ Add a note at this moment")}
            </button>
          )}
          {notes.length > 0 && (
            <ol className="note-list">
              {notes.map((n) => (
                <li key={n.id} className={n.seq === pos ? "on" : undefined}>
                  <button className="link" onClick={() => goTo(n.seq)}>
                    <span className="muted">
                      {t("{chapter}:", { chapter: chapterOf(n.seq)?.title ?? t("Setup") })}
                    </span>{" "}
                    {n.text || tn(n.marks.length, "{n} mark", "{n} marks")}
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
        {tn(c.actions, "{n} action", "{n} actions")}
        {notes ? ` · ✎ ${notes}` : ""}
      </span>
      {c.highlights.length > 0 && <div className="small">{c.highlights.join(" · ")}</div>}
      {c.roundCard && (
        <div className="muted small">
          {t("End of round {round}:", { round: c.roundCard.round })}{" "}
          {c.roundCard.players
            .map((p) =>
              p.modelsLost
                ? t("{name} {vp} VP, lost {lost}", { name: p.name, vp: p.vp, lost: p.modelsLost })
                : t("{name} {vp} VP", { name: p.name, vp: p.vp }),
            )
            .join(" · ")}
        </div>
      )}
    </li>
  );
}

function NoteView({ note }: { note: ReplayNote }) {
  // In a review room, only a note's writer changes it; a replay on this device is yours to tidy.
  const review = useStore((s) => s.review);
  return (
    <div className="note" style={{ borderColor: note.color }}>
      <strong style={{ color: note.color }}>{note.by}</strong>
      {note.text && <p>{note.text}</p>}
      {note.marks.length > 0 && (
        <span className="muted small">
          {tn(note.marks.length, "{n} mark on the table", "{n} marks on the table")}
        </span>
      )}
      {(ownNote(note) || !review) && (
        <div className="row">
          <button className="small link" onClick={() => startDraft(note.seq, note)}>
            {t("Edit")}
          </button>
          <button className="small link" onClick={() => removeNote(note.id)}>
            {t("Delete")}
          </button>
        </div>
      )}
    </div>
  );
}

const TOOLS = () =>
  [
    { id: "arrow", label: t("↗ Arrow") },
    { id: "area", label: t("◯ Area") },
    { id: "ping", label: t("📍 Pin") },
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
        aria-label={t("Note")}
        rows={3}
        autoFocus
        placeholder={t("What happened here, or what should have…")}
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      <div className="row wrap">
        {TOOLS().map((x) => (
          <button
            key={x.id}
            type="button"
            className={`small${tool === x.id ? " on" : ""}`}
            title={t("Draw on the table for this note")}
            onClick={() => useTalk.setState({ tool: tool === x.id ? null : x.id })}
          >
            {x.label}
          </button>
        ))}
        {draft.marks.length > 0 && (
          <button
            type="button"
            className="small quiet"
            onClick={() => set({ marks: draft.marks.slice(0, -1) })}
          >
            {t("Undo mark ({n})", { n: draft.marks.length })}
          </button>
        )}
      </div>
      {!myName() && (
        <input
          aria-label={t("Your name")}
          placeholder={t("Your name, on the note")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <div className="row">
        <button className="small primary">{t("Save the note")}</button>
        <button
          type="button"
          className="small"
          onClick={() => {
            useTalk.setState({ tool: null });
            useNotes.setState({ draft: null });
          }}
        >
          {t("Cancel")}
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
        title={t("Invite others to watch this replay with you")}
      >
        {t("Watch together…")}
      </button>
    );
  return (
    <div className="watch-together">
      <p className="small">
        {t(
          "Opens this replay online. Anyone with the link watches along with you, and can add notes that everyone sees, like a coach going over the game.",
        )}
      </p>
      <div className="row">
        <button className="small primary" onClick={() => startReview()}>
          {t("Open it and get a link")}
        </button>
        <button className="small" onClick={() => setAsking(false)}>
          {t("Cancel")}
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
        <strong>{t("Watching together")}</strong> ·{" "}
        {peers ? tn(peers, "{n} other here", "{n} others here") : t("nobody else yet")}
        {" · "}
        {leading
          ? t("you lead: everyone following sees what you scrub to")
          : !leader
            ? t("finding who's leading…")
            : following
              ? t("following {name}", { name: leaderName || t("the leader") })
              : t("on your own")}
      </p>
      <div className="row wrap">
        {!leading && !following && leader && (
          <button className="small primary" onClick={followLeader}>
            {t("Follow {name} again", { name: leaderName || t("the leader") })}
          </button>
        )}
        {!leading && (
          <button className="small" onClick={takeLead}>
            {t("Lead")}
          </button>
        )}
        <button className="small" onClick={copy}>
          {copied ? t("Link copied") : t("Copy the invite link")}
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
          <strong style={{ color: n.color }}>{t("{name}:", { name: n.by })}</strong> {n.text}
        </p>
      ))}
    </div>
  );
}
