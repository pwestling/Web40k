import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { systemOf, type GameState } from "../core";
import { formatDate, language, t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import { untakenSeat } from "../ui/Branch";
import { plainSystemName, systemLabel } from "../ui/systemLabels";
import { useStore } from "../store";
import { useMail } from "../mail/store";
import { inviteCode } from "../mail/mailbox";
import {
  blockName,
  board,
  boardOn,
  hidePost,
  pageClosing,
  postTable,
  reportPost,
  resumeTable,
  shownPosts,
  takeDown,
  unblockAll,
  updateTable,
  useOpenTables,
  type BoardStatus,
} from "./board";
import { LIMITS, LIVE_HOURS, MAIL_TTL_MS, newPostId, type SeenPost, type TableKind } from "./post";

/** The time a post is made (pressing Post, not drawing the form). */
const clock = () => Date.now();

/** Languages offered for a table, by code; the names come from the browser. */
const TABLE_LANGUAGES = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "pl",
  "pt",
  "sv",
  "da",
  "nb",
  "fi",
  "cs",
  "ru",
  "uk",
  "ja",
  "ko",
  "zh",
];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([language()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** When a table starts, said the way a player would. */
function whenText(start: number | null, now = Date.now()): string {
  if (start === null || start <= now + 60_000) return t("Now");
  const minutes = Math.round((start - now) / 60_000);
  if (minutes < 60) return tn(minutes, "In {n} minute", "In {n} minutes");
  return formatDate(start, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** Open seats at a live table: the sides' seats not yet taken. */
export function openSeats(game: GameState, record = useStore.getState().record): number {
  const size = game.settings.teamSize ?? 1;
  const seated = Object.values(game.players).filter(
    (p) => p.seat !== undefined && !untakenSeat(record, p.id),
  );
  return Math.max(0, size * 2 - seated.length);
}

/**
 * The board (#50): open tables other players have posted, with filters,
 * and Join, which goes straight to their table. Reading it posts nothing.
 */
export function OpenTablesBoard({
  onClose,
  onJoin,
  onHost,
}: {
  onClose: () => void;
  onJoin: (room: string) => void;
  onHost: () => void;
}) {
  const [posts, setPosts] = useState<SeenPost[]>([]);
  const [status, setStatus] = useState<BoardStatus>({ reached: 0, of: 0, loaded: false });
  const [key, setKey] = useState<string | null>(null);
  const prefs = useOpenTables();
  const [game, setGame] = useState("");
  const [kind, setKind] = useState<"" | TableKind>("");
  const [lang, setLang] = useState("");
  const [voice, setVoice] = useState<"" | "on" | "off">("");
  const [, tick] = useState(0);
  const close = useRef(onClose);
  useEffect(() => void (close.current = onClose), [onClose]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let live = true;
    void board().then((b) => {
      if (!b || !live) return;
      setKey(b.key);
      stop = b.watch(setPosts, setStatus);
    });
    // "In 5 minutes" counts down, and posts run out.
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      stop?.();
      clearInterval(timer);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  const shown = useMemo(() => shownPosts(posts, prefs), [posts, prefs]);
  const games = [...new Map(shown.map((p) => [p.system, p.game])).entries()];
  const langs = [...new Set(shown.map((p) => p.lang))];
  const list = shown
    .filter(
      (p) =>
        (!game || p.system === game) &&
        (!kind || p.kind === kind) &&
        (!lang || p.lang === lang) &&
        (!voice || p.voice === (voice === "on")),
    )
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || b.at - a.at);
  const blocked = prefs.blockedNames.length + prefs.hidden.length;
  const join = (p: SeenPost) => {
    onClose();
    if (p.kind === "live") onJoin(p.join);
    else window.location.assign(`#mail=${p.join}`);
  };

  // On the page itself: the lobby scrolls, and a modal inside it would sit where it started.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel modal open-tables"
        role="dialog"
        aria-label={t("Open tables")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>{t("Open tables")}</h2>
          <button className="quiet" title={t("Close")} onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">
          {t(
            "Games other players have put up, looking for an opponent. Join takes you to their table. Looking posts nothing: your own table shows here only when you post it.",
          )}
        </p>
        <div className="row wrap table-filters">
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label={t("Game")}>
            <option value="">{t("Any game")}</option>
            {games.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "" | TableKind)}
            aria-label={t("Live or by mail")}
          >
            <option value="">{t("Live or by mail")}</option>
            <option value="live">{t("Live")}</option>
            <option value="mail">{t("By mail")}</option>
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("Language")}>
            <option value="">{t("Any language")}</option>
            {langs.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </select>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value as "" | "on" | "off")}
            aria-label={t("Voice")}
          >
            <option value="">{t("Voice or not")}</option>
            <option value="on">{t("With voice")}</option>
            <option value="off">{t("Text only")}</option>
          </select>
        </div>
        <p className="muted small" role="status">
          {!status.loaded
            ? t("Looking at the board…")
            : status.reached === 0
              ? t("Couldn't reach the board. Check your connection; it tries again on its own.")
              : list.length
                ? tn(list.length, "{n} open table", "{n} open tables")
                : shown.length
                  ? t("No open tables match. Try Any in the filters.")
                  : t("No open tables right now. Put yours up and others will find it.")}
        </p>
        <ul className="table-posts">
          {list.map((p) => (
            <TablePostCard key={`${p.key}:${p.id}`} post={p} mine={p.key === key} onJoin={() => join(p)} />
          ))}
        </ul>
        <div className="row spread wrap">
          <button className="primary" onClick={onHost}>
            {t("Host a table and post it")}
          </button>
          {blocked > 0 && (
            <button className="link small" onClick={unblockAll}>
              {tn(blocked, "Show {n} hidden or blocked again", "Show {n} hidden or blocked again")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TablePostCard({ post, mine, onJoin }: { post: SeenPost; mine: boolean; onJoin: () => void }) {
  const [reporting, setReporting] = useState(false);
  const details = [
    post.name,
    post.size,
    languageName(post.lang),
    post.kind === "live" ? t("live") : t("by mail"),
    post.voice ? t("voice on") : t("text only"),
    tn(post.seats, "{n} seat open", "{n} seats open"),
  ].filter(Boolean);
  return (
    <li className="table-post">
      <div className="row spread">
        <strong>{post.game}</strong>
        <span className="small when">{post.kind === "mail" ? t("Any time") : whenText(post.start)}</span>
      </div>
      <div className="small muted">{details.join(" · ")}</div>
      {post.note && <p className="small table-note">{post.note}</p>}
      {reporting ? (
        <div className="row wrap" role="group" aria-label={t("Report this table")}>
          <span className="small">{t("What's wrong with it?")}</span>
          {[
            ["spam", t("Spam")],
            ["nudity", t("Offensive")],
            ["impersonation", t("Pretending to be someone")],
            ["other", t("Something else")],
          ].map(([why, label]) => (
            <button key={why} className="small" onClick={() => void reportPost(post, why!)}>
              {label}
            </button>
          ))}
          <button className="quiet small" onClick={() => setReporting(false)}>
            {t("Cancel")}
          </button>
        </div>
      ) : (
        <div className="row wrap">
          {mine ? (
            <span className="small muted">{t("Your table")}</span>
          ) : (
            <button className="primary small" onClick={onJoin}>
              {t("Join")}
            </button>
          )}
          {!mine && (
            <>
              <button className="quiet small" onClick={() => hidePost(post)}>
                {t("Hide")}
              </button>
              <button className="quiet small" onClick={() => blockName(post)}>
                {t("Block {name}", { name: post.name })}
              </button>
              <button className="quiet small" onClick={() => setReporting(true)}>
                {t("Report")}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Put this table on the board: the player fills in what others see, and
 * nothing goes up until they press Post. A live table needs a room; a mail
 * game, its invite.
 */
export function PostTable({ kind, join, seats }: { kind: TableKind; join: string; seats: number }) {
  const mine = useOpenTables((s) => s.mine);
  const asked = useOpenTables((s) => s.asked);
  const game = useStore((s) => s.game);
  const session = useStore((s) => s.session);
  const mailMe = useMail((s) => s.game?.names[s.game.me]);
  const [open, setOpen] = useState(asked);
  const [size, setSize] = useState("");
  const [when, setWhen] = useState("now");
  const [at, setAt] = useState("");
  const [lang, setLang] = useState(() => language());
  const [voice, setVoice] = useState(false);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(3);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (asked) useOpenTables.setState({ asked: false });
  }, [asked]);
  if (!boardOn()) return null;
  const name =
    (kind === "mail" ? mailMe : displayName(game.players[session?.selfId ?? ""]?.name ?? "")) ||
    t("A player");
  const system = game.system ?? systemOf(game).id;
  const gameName = plainSystemName(systemLabel(system, systemOf(game).name));
  const here = mine && mine.post.join === join;

  if (here)
    return (
      <div className="my-table small" role="status">
        {mine.state === "posting"
          ? t("Posting on Open tables…")
          : mine.state === "failed"
            ? t("The board didn't take your post. Check your connection and try again.")
            : tn(mine.post.seats, "On Open tables: {n} seat open.", "On Open tables: {n} seats open.")}{" "}
        <button className="link" onClick={() => void takeDown()}>
          {mine.state === "failed" ? t("Close") : t("Take it down")}
        </button>
      </div>
    );
  if (!open)
    return (
      <button
        className="small"
        onClick={() => setOpen(true)}
        title={t("Let players you don't know find this game")}
      >
        {t("Post on Open tables")}
      </button>
    );
  const submit = async () => {
    setBusy(true);
    const now = clock();
    const start =
      when === "now"
        ? null
        : when === "at"
          ? at
            ? new Date(at).getTime()
            : null
          : now + Number(when) * 60_000;
    const ok = await postTable({
      id: newPostId(),
      name: name.slice(0, LIMITS.name),
      system,
      game: gameName.slice(0, LIMITS.game),
      size: size.trim(),
      start,
      lang,
      kind,
      voice,
      seats: Math.max(1, seats),
      note: note.trim(),
      join,
      expires: now + (kind === "live" ? hours * 3600_000 : MAIL_TTL_MS),
    });
    setBusy(false);
    if (ok) setOpen(false);
  };
  return (
    <form
      className="post-table"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <strong>{t("Post on Open tables")}</strong>
      <p className="muted small">
        {t(
          "Anyone looking at Open tables sees your name ({name}), the game ({game}) and what you fill in here.",
          {
            name,
            game: gameName,
          },
        )}
      </p>
      <label>
        {t("Size")}{" "}
        <input
          value={size}
          maxLength={LIMITS.size}
          placeholder={t("e.g. 1000 points")}
          onChange={(e) => setSize(e.target.value)}
        />
      </label>
      {kind === "live" && (
        <label>
          {t("Starts")}{" "}
          <select value={when} onChange={(e) => setWhen(e.target.value)}>
            <option value="now">{t("Now")}</option>
            <option value="15">{tn(15, "In {n} minute", "In {n} minutes")}</option>
            <option value="30">{tn(30, "In {n} minute", "In {n} minutes")}</option>
            <option value="60">{tn(1, "In {n} hour", "In {n} hours")}</option>
            <option value="at">{t("At a time…")}</option>
          </select>
          {when === "at" && (
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              aria-label={t("Start time")}
            />
          )}
        </label>
      )}
      <label>
        {t("Language")}{" "}
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {[...new Set([lang, ...TABLE_LANGUAGES])].map((l) => (
            <option key={l} value={l}>
              {languageName(l)}
            </option>
          ))}
        </select>
      </label>
      {kind === "live" && (
        <label className="check">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
          {t("We'll talk over voice")}
        </label>
      )}
      <label>
        {t("Note")}{" "}
        <input
          value={note}
          maxLength={LIMITS.note}
          placeholder={t("e.g. relaxed game, new players welcome")}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {kind === "live" ? (
        <label>
          {t("Stays up for")}{" "}
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {LIVE_HOURS.map((h) => (
              <option key={h} value={h}>
                {tn(h, "{n} hour", "{n} hours")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="muted small">
        {kind === "live"
          ? t("It comes down when your seats fill, when you leave the game, or after that time.")
          : t("It comes down when someone takes the game, or after two days.")}
      </p>
      <div className="row">
        <button className="primary" type="submit" disabled={busy || (when === "at" && !at)}>
          {busy ? t("Posting…") : t("Post")}
        </button>
        <button type="button" className="quiet" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Keeps this browser's post true to its table while the game is open: the
 * seats left, down when they fill or the player leaves, back up after a
 * reload. Mounted with the game screen.
 */
export function MyTableKeeper() {
  const mine = useOpenTables((s) => s.mine);
  const roomId = useStore((s) => s.roomId);
  const role = useStore((s) => s.net?.role);
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const mail = useMail((s) => s.game);
  const live = mine?.post.kind === "live";
  const seats = live ? openSeats(game, record) : 0;

  useEffect(() => {
    if (!mine || mine.state === "failed") return;
    if (live) {
      // Not this table any more (another room, or no longer its host).
      if (roomId !== mine.post.join || (role && role !== "host")) return void takeDown();
      if (seats <= 0 || game.turn.round > 0) return void takeDown();
      if (mine.state === "up" && seats !== mine.post.seats) void updateTable({ seats });
    } else if (mail) {
      // Someone took the mail game: their first file has come.
      if (mail.theirKey && mail.box && inviteCode(mail.box) === mine.post.join) void takeDown();
    }
  }, [mine, live, roomId, role, seats, game.turn.round, mail]);

  useEffect(() => {
    if (live && roomId === useOpenTables.getState().mine?.post.join) void resumeTable();
  }, [live, roomId]);

  useEffect(() => {
    window.addEventListener("pagehide", pageClosing);
    return () => window.removeEventListener("pagehide", pageClosing);
  }, []);
  return null;
}
