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
import { myName, say, setMyName } from "../talk/talk";
import { knock } from "../ui/sound";
import { liveInfo, useWatching } from "./live";
import { NET_PARAMS } from "../net/config";
import {
  blockPoster,
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
import {
  HEARTBEAT_MS,
  isLiveGame,
  LIMITS,
  LIVE_HOURS,
  MAIL_TTL_MS,
  newPostId,
  TABLE_TAGS,
  tagsOf,
  type SeenPost,
  type TableKind,
  type TableTag,
} from "./post";

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

/** The form's start choice, said on the Post button. */
function whenLabel(when: string, at: string): string {
  if (when === "now") return t("now");
  if (when === "at")
    return at
      ? formatDate(new Date(at).getTime(), { weekday: "short", hour: "numeric", minute: "2-digit" })
      : "";
  return tn(Number(when), "in {n} minute", "in {n} minutes");
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
  onJoin: (room: string, name: string) => void;
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
  const [style, setStyle] = useState<"" | TableTag>("");
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
  // Games under way, to watch (#64): above the tables looking for players.
  const liveNow = shown
    .filter((p) => isLiveGame(p) && (!game || p.system === game) && (!lang || p.lang === lang))
    .sort((a, b) => (b.live?.watching ?? 0) - (a.live?.watching ?? 0) || b.at - a.at);
  const list = shown
    .filter((p) => !isLiveGame(p))
    .filter(
      (p) =>
        (!game || p.system === game) &&
        (!kind || p.kind === kind) &&
        (!lang || p.lang === lang) &&
        (!voice || p.voice === (voice === "on")) &&
        (!style || tagsOf(p).includes(style)),
    )
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || b.at - a.at);
  const blocked = prefs.blockedNames.length + prefs.blockedKeys.length + prefs.hidden.length;
  const styles = TABLE_TAGS.filter((tag) => shown.some((p) => tagsOf(p).includes(tag)));
  const join = (p: SeenPost, name: string) => {
    if (name) setMyName(name);
    useOpenTables.setState({ joined: p, gone: false });
    onClose();
    if (p.kind === "live") onJoin(p.join, name);
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
          {styles.length > 0 && (
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as "" | TableTag)}
              aria-label={t("Kind of game")}
            >
              <option value="">{t("Any kind of game")}</option>
              {styles.map((tag) => (
                <option key={tag} value={tag}>
                  {tagLabel(tag)}
                </option>
              ))}
            </select>
          )}
        </div>
        {prefs.gone && (
          <p className="table-gone" role="status">
            {tn(
              list.length,
              "That table has gone: its host has left. {n} other is open.",
              "That table has gone: its host has left. {n} others are open.",
            )}{" "}
            <button className="link small" onClick={() => useOpenTables.setState({ gone: false })}>
              {t("OK")}
            </button>
          </p>
        )}
        {liveNow.length > 0 && (
          <section className="live-now" aria-label={t("Live now")}>
            <h3>
              <span className="dot live" aria-hidden /> {t("Live now")}
            </h3>
            <ul className="table-posts">
              {liveNow.map((p) => (
                <LiveGameCard key={`${p.key}:${p.id}`} post={p} onWatch={() => watchGame(p)} />
              ))}
            </ul>
          </section>
        )}
        <p className="muted small" role="status">
          {!status.loaded
            ? t("Looking at the board…")
            : status.reached === 0
              ? t("Couldn't reach the board. Check your connection; it tries again on its own.")
              : list.length
                ? tn(list.length, "{n} open table", "{n} open tables")
                : shown.some((p) => !isLiveGame(p))
                  ? t("No open tables match. Try Any in the filters.")
                  : t("No open tables right now. Put yours up and others will find it.")}
        </p>
        <ul className="table-posts">
          {list.map((p) => (
            <TablePostCard
              key={`${p.key}:${p.id}`}
              post={p}
              mine={p.key === key}
              onJoin={(name) => join(p, name)}
            />
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

/**
 * Watch a game from Live now (#64): into its room as a spectator, in the
 * broadcast view, running behind the game so secrets and table talk stay safe.
 */
function watchGame(p: SeenPost): void {
  const q = new URLSearchParams({
    room: p.join,
    view: "broadcast",
    delay: String(WATCH_DELAY),
    from: "tables",
  });
  const here = new URLSearchParams(location.search);
  for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
  window.location.assign(`${location.pathname}?${q}`);
}

/** Seconds a watcher from Live now runs behind the game. */
const WATCH_DELAY = 30;

function LiveGameCard({ post, onWatch }: { post: SeenPost; onWatch: () => void }) {
  const live = post.live!;
  const details = [
    post.game,
    live.rounds
      ? t("round {n} of {of}", { n: live.round, of: live.rounds })
      : t("round {n}", { n: live.round }),
    live.score,
    tn(live.watching, "{n} watching", "{n} watching"),
  ].filter(Boolean);
  return (
    <li className="table-post live-game">
      <div className="row spread">
        <strong className="table-lead">{t("{name}'s table", { name: displayName(post.name) })}</strong>
        <span className="small muted when">{freshness(post)}</span>
      </div>
      <div className="small muted">{details.join(" · ")}</div>
      {post.note && <p className="small table-note">“{post.note}”</p>}
      <div className="row">
        <button className="primary" onClick={onWatch}>
          {t("Watch")}
        </button>
      </div>
    </li>
  );
}

/** How fresh a post is: its host here now, or when it was last seen. */
function freshness(p: SeenPost, now = Date.now()): string {
  const minutes = Math.floor((now - p.at) / 60_000);
  if (p.kind === "live" && now - p.at < 2 * HEARTBEAT_MS) return t("here now");
  if (minutes < 60) return tn(Math.max(1, minutes), "seen {n} min ago", "seen {n} min ago");
  return tn(Math.round(minutes / 60), "posted {n} hour ago", "posted {n} hours ago");
}

const tagLabel = (tag: TableTag) =>
  tag === "new"
    ? t("New players welcome")
    : tag === "relaxed"
      ? t("Relaxed")
      : tag === "competitive"
        ? t("Competitive")
        : t("Narrative");

function TablePostCard({
  post,
  mine,
  onJoin,
}: {
  post: SeenPost;
  mine: boolean;
  onJoin: (name: string) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState(() => myName() ?? "");
  const host = displayName(post.name);
  const soon = post.kind === "live" && post.start !== null && post.start > clock() + 60_000;
  // The person first, then the game (PX: inviting, not a spec sheet).
  const lead =
    post.kind === "mail"
      ? t("{name} is looking for an opponent by mail", { name: host })
      : soon
        ? t("{name} is playing {when}", { name: host, when: whenText(post.start).toLowerCase() })
        : t("{name} is waiting for an opponent", { name: host });
  const details = [
    post.game,
    post.size,
    languageName(post.lang),
    post.voice ? t("voice on") : t("text only"),
    post.seats > 1 ? tn(post.seats, "{n} seat open", "{n} seats open") : "",
  ].filter(Boolean);
  const tags = tagsOf(post);
  return (
    <li className="table-post">
      <div className="row spread">
        <strong className="table-lead">{lead}</strong>
        <span className="small muted when">{freshness(post)}</span>
      </div>
      {tags.length > 0 && (
        <div className="row wrap table-tags">
          {tags.map((tag) => (
            <span key={tag} className={`table-tag ${tag}`}>
              {tagLabel(tag)}
            </span>
          ))}
        </div>
      )}
      <div className="small muted">{details.join(" · ")}</div>
      {post.note && <p className="small table-note">“{post.note}”</p>}
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
      ) : joining ? (
        <form
          className="join-table"
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(name.trim());
          }}
        >
          <p className="small">
            {post.kind === "live"
              ? t(
                  "You'll join {name}'s table as the other player. They'll see your name. You can leave any time.",
                  {
                    name: host,
                  },
                )
              : t("You'll take {name}'s game by mail. They'll see your name. You can stop any time.", {
                  name: host,
                })}
          </p>
          <label className="small">
            {t("Your name")}{" "}
            <input
              value={name}
              maxLength={LIMITS.name}
              autoFocus
              placeholder={t("What should they call you?")}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="primary join" type="submit" disabled={!name.trim()}>
              {t("Join {name}", { name: host })}
            </button>
            <button type="button" className="quiet" onClick={() => setJoining(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="row spread">
          {mine ? (
            <span className="small muted">{t("Your table")}</span>
          ) : (
            <button className="primary join" onClick={() => setJoining(true)}>
              {t("Join")}
            </button>
          )}
          {!mine && (
            // Safety tools one tap away, not the first thing read (PX, UX 384).
            <details className="post-more">
              <summary aria-label={t("More")} title={t("More")}>
                ⋯
              </summary>
              <div className="post-menu">
                <button className="quiet small" onClick={() => hidePost(post)}>
                  {t("Hide this table")}
                </button>
                <button className="quiet small" onClick={() => blockPoster(post)}>
                  {t("Block {name}", { name: host })}
                </button>
                <button className="quiet small" onClick={() => setReporting(true)}>
                  {t("Report")}
                </button>
              </div>
            </details>
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
  // The army on the table says how big a game it is, until the host types otherwise (dogfood).
  const [sizeTyped, setSize] = useState<string | null>(null);
  const myPoints = Object.values(game.units)
    .filter((u) => u.owner === session?.selfId)
    .reduce((n, u) => n + (u.sheet?.points ?? 0), 0);
  const size = sizeTyped ?? (myPoints ? t("{n} points", { n: myPoints }) : "");
  const [when, setWhen] = useState("now");
  const [at, setAt] = useState("");
  const [lang, setLang] = useState(() => language());
  const [voice, setVoice] = useState(false);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(3);
  const [tags, setTags] = useState<TableTag[]>([]);
  // Public tables welcome watchers unless the host says not (#64).
  const [watch, setWatch] = useState(true);
  const [busy, setBusy] = useState(false);
  const self = game.players[session?.selfId ?? ""];
  // Ask for the name here: a post from "Player 1" can't be told apart (UX 382).
  // Until typed in, it follows the room's, so a name given in the side panel fills this too (PX).
  const [edited, setTyped] = useState<string | null>(null);
  const own = kind === "mail" ? mailMe : self?.name;
  const typed = edited ?? (own && !/^Player \d+$/.test(own) ? own : (myName() ?? ""));
  useEffect(() => {
    if (asked) useOpenTables.setState({ asked: false });
  }, [asked]);
  if (!boardOn()) return null;
  const name = typed.trim().slice(0, LIMITS.name);
  const system = game.system ?? systemOf(game).id;
  const gameName = plainSystemName(systemLabel(system, systemOf(game).name));
  const here = mine && mine.post.join === join;

  if (here)
    return (
      <div className={`my-table small ${mine.state === "failed" ? "failed" : ""}`} role="status">
        {mine.state === "up" && <span className="dot" aria-hidden />}
        <span>
          {mine.state === "posting"
            ? t("Posting on Open tables…")
            : mine.state === "failed"
              ? mine.why === "busy"
                ? t("Too many tables from this network right now; try again in a few minutes.")
                : t("The board didn't take your post. Check your connection and try again.")
              : mine.post.live && mine.post.seats === 0
                ? tn(
                    mine.post.live.watching,
                    "Live now on Open tables · {n} watching",
                    "Live now on Open tables · {n} watching",
                  )
                : tn(
                    mine.post.seats,
                    "Listed on Open tables · {n} seat open",
                    "Listed on Open tables · {n} seats open",
                  )}
        </span>
        <button className="small" onClick={() => void takeDown()}>
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
    setMyName(name);
    // The room shows the same name the board does.
    if (kind === "live" && self && self.name !== name)
      useStore.getState().dispatch({ type: "player/rename", player: self.id, name }, self.id);
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
      ...(tags.length ? { tags } : {}),
      ...(kind === "live" && watch ? { watch: true } : {}),
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
        {t("Anyone looking at Open tables sees your name, the game ({game}) and what you fill in here.", {
          game: gameName,
        })}
      </p>
      <label>
        {t("Your name")}{" "}
        <input
          value={typed}
          maxLength={LIMITS.name}
          required
          placeholder={t("What should they call you?")}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
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
      {kind === "live" && (
        <label className="check">
          <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
          {t("Allow watchers: once your seats fill, it shows under Live now")}
        </label>
      )}
      <label>
        {t("Note")}{" "}
        <input
          value={note}
          maxLength={LIMITS.note}
          placeholder={t("e.g. happy to explain the rules")}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="row wrap post-tags" role="group" aria-label={t("Kind of game")}>
        {TABLE_TAGS.map((tag) => (
          <label key={tag} className="check small">
            <input
              type="checkbox"
              checked={tags.includes(tag)}
              onChange={(e) => setTags(e.target.checked ? [...tags, tag] : tags.filter((x) => x !== tag))}
            />
            {tagLabel(tag)}
          </label>
        ))}
      </div>
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
          ? watch
            ? t(
                "Once your seats fill it moves to Live now, and comes down when the game ends, when you leave, or after that time.",
              )
            : t("It comes down when your seats fill, when you leave the game, or after that time.")
          : t("It comes down when someone takes the game, or after two days.")}
      </p>
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !name || (when === "at" && !at)}>
          {busy
            ? t("Posting…")
            : t("Post: {summary}", {
                summary: [gameName, size.trim(), kind === "mail" ? t("by mail") : whenLabel(when, at)]
                  .filter(Boolean)
                  .join(", "),
              })}
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

  const watching = useWatching();
  const now =
    live && mine?.post.watch && (seats <= 0 || game.turn.round > 0) ? liveInfo(game, watching) : null;
  const over = game.turn.round > (Number(systemOf(game).turn.rounds) || Infinity);
  const nowKey = now ? JSON.stringify(now) : "";

  useEffect(() => {
    if (!mine || mine.state === "failed") return;
    if (live) {
      // Not this table any more (another room, or no longer its host).
      if (roomId !== mine.post.join || (role && role !== "host")) return void takeDown();
      // Watchers welcome: a full table stays up under Live now with its round and score, until the end (#64).
      if (now && !over) {
        if (mine.state === "up" && (mine.post.seats !== 0 || JSON.stringify(mine.post.live) !== nowKey))
          void updateTable({ seats: 0, live: now });
        return;
      }
      if (seats <= 0 || game.turn.round > 0) return void takeDown();
      if (mine.state === "up" && seats !== mine.post.seats) void updateTable({ seats });
    } else if (mail) {
      // Someone took the mail game: their first file has come.
      if (mail.theirKey && mail.box && inviteCode(mail.box) === mine.post.join) void takeDown();
    }
  }, [mine, live, roomId, role, seats, game.turn.round, mail, nowKey, over]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (live && roomId === useOpenTables.getState().mine?.post.join) void resumeTable();
  }, [live, roomId]);

  useEffect(() => {
    window.addEventListener("pagehide", pageClosing);
    return () => window.removeEventListener("pagehide", pageClosing);
  }, []);
  return null;
}

/**
 * Someone sat down at a table listed on Open tables: a soft knock, who it
 * is, and a hello to send in one tap (PX). Mounted with the game screen.
 */
export function TableArrivals() {
  return (
    <>
      <HostArrival />
      <GuestArrival />
    </>
  );
}

/** The guest's side of sitting down: whose table this is, their note, and the same hellos (PX). */
function GuestArrival() {
  const roomId = useStore((s) => s.roomId);
  const post = useOpenTables((s) => (s.joined?.join === roomId ? s.joined : null));
  const hostThere = useStore((s) => {
    const host = s.net?.hostId;
    return !!host && host !== s.session?.selfId && !!s.game.players[host] && s.game.turn.round === 0;
  });
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!hostThere) return;
    const timer = setTimeout(() => setClosed(true), 45_000);
    return () => clearTimeout(timer);
  }, [hostThere]);
  if (!post || !hostThere || closed) return null;
  const hello = (text: string) => {
    say({ kind: "chat", text });
    setClosed(true);
  };
  return (
    <div className="arrival" role="status">
      <div className="row spread">
        <strong>{t("You're at {name}'s table", { name: displayName(post.name) })}</strong>
        <button className="quiet small" title={t("Close")} onClick={() => setClosed(true)}>
          ✕
        </button>
      </div>
      {post.note && <p className="small">“{post.note}”</p>}
      <div className="row wrap">
        {[t("👋 Hi!"), t("Thanks for having me"), t("Ready when you are")].map((text) => (
          <button key={text} className="small" onClick={() => hello(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function HostArrival() {
  const listed = useOpenTables((s) => s.listed);
  const roomId = useStore((s) => s.roomId);
  const selfId = useStore((s) => s.session?.selfId);
  const [arrived, setArrived] = useState<string | null>(null);
  const name = useStore((s) => (arrived ? s.game.players[arrived]?.name : undefined));

  useEffect(() => {
    if (!listed || listed !== roomId) return;
    const seated = (s: ReturnType<typeof useStore.getState>) =>
      Object.values(s.game.players)
        .filter((p) => p.seat !== undefined && p.id !== selfId && !untakenSeat(s.record, p.id))
        .map((p) => p.id);
    let before = new Set(seated(useStore.getState()));
    return useStore.subscribe((s) => {
      const now = seated(s);
      const fresh = now.find((id) => !before.has(id));
      before = new Set(now);
      if (fresh && s.game.turn.round === 0) {
        knock();
        setArrived(fresh);
      }
    });
  }, [listed, roomId, selfId]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(null), 30_000);
    return () => clearTimeout(timer);
  }, [arrived]);

  if (!arrived || !name) return null;
  const hello = (text: string) => {
    say({ kind: "chat", text });
    setArrived(null);
  };
  return (
    <div className="arrival" role="status">
      <div className="row spread">
        <strong>{t("{name} joined from Open tables", { name: displayName(name) })}</strong>
        <button className="quiet small" title={t("Close")} onClick={() => setArrived(null)}>
          ✕
        </button>
      </div>
      <div className="row wrap">
        {[t("👋 Hi!"), t("Welcome to the table"), t("Ready when you are")].map((text) => (
          <button key={text} className="small" onClick={() => hello(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
