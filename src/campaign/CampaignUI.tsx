import { safeFileName, saveJson } from "../ui/files";
import { useEffect, useMemo, useRef, useState } from "react";
import { afterGameDone, nextCampaignHook } from "./rules";
import { sidePlayers, sides, type GameState } from "../core";
import { pendingScores } from "../missions/scoring";
import { getSystem } from "../core/content/systems";
import { useShelf } from "../packages/shelf";
import { useCanControl, useStore } from "../store";
import { missionOf } from "../ui/Missions";
import { useDeployed } from "../ui/shelfActions";
import { battleOver } from "../ui/StatsScreen";
import { systemLabel } from "../ui/systemLabels";
import {
  campaignUnitKey,
  gameId,
  leagueTable,
  newCampaign,
  readCampaign,
  recordGame,
  type CampaignBook,
  type CampaignUnit,
  type Territory,
} from "./book";
import { useTables } from "../tables/library";
import { applyLayout } from "../tables/actions";
import { mergeBooks, openPairing } from "./event";
import { EventLine, EventTab } from "./EventTab";
import { requestCampaign, useCampaignSharing, useCampaignTransfers } from "./share";
import { loadReplay, replayIds, saveReplay, useCampaigns } from "./store";
import { create } from "zustand";
import { useLibrary } from "../packages/library";
import { CampaignRulesLine, rulesOff, turnOnRules } from "./RulesLine";
import { formatDate, t, tc, tn } from "../i18n";

/** Which book is open on screen. */
const useBookOpen = create<{ id: string | null }>(() => ({ id: null }));

const systemName = (id: string) => {
  try {
    return getSystem(id).name;
  } catch {
    return id;
  }
};

/** How this device's copy compares with the one the game is played for. */
function useCopy(): "none" | "missing" | "same" | "different" {
  const ref = useStore((s) => s.game.campaign);
  const book = useCampaigns((s) => (ref ? s.books[ref.id] : undefined));
  const hash = useCampaigns((s) => (ref ? s.hashes[ref.id] : undefined));
  if (!ref) return "none";
  if (!book) return "missing";
  return hash === ref.hash ? "same" : "different";
}

/**
 * In the game: keeps the book's links and results up to date. Each player's
 * shelf army is linked to the book; when the battle ends, the game goes into
 * every peer's copy the same way (and its replay is kept on this device).
 */
export function CampaignKeeper() {
  useCampaignSharing();
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const live = useStore((s) => s.session !== null && s.scrub === null);
  const dispatch = useStore((s) => s.dispatch);
  const canControl = useCanControl();
  const deployed = useDeployed();
  const books = useCampaigns((s) => s.books);
  const ref = game.campaign;
  useEffect(() => {
    void useCampaigns.getState().load();
    void useShelf.getState().load();
  }, []);
  // The game's copy, fetched from the room when this device has none.
  const copy = useCopy();
  const edited = useCampaigns((s) => (ref ? !!s.edited[ref.id] : false));
  // A copy that differs and hasn't been changed by hand here is just behind: take the table's (UX 202).
  useEffect(() => {
    if (live && ref && (copy === "missing" || (copy === "different" && !edited))) requestCampaign(ref.hash);
  }, [live, ref, copy, edited]);
  // The table's copy came while this device had games from other tables: the joined copy goes back to the table.
  const merged = useCampaigns((s) => (ref ? !!s.merged[ref.id] : false));
  useEffect(() => {
    if (!live || !ref || !merged) return;
    const mine = Object.values(game.players).find((p) => p.seat !== undefined && canControl(p.id));
    const hash = useCampaigns.getState().hashes[ref.id];
    if (!mine || !hash) return;
    useCampaigns.setState((s) => ({
      merged: { ...s.merged, [ref.id]: false },
      edited: { ...s.edited, [ref.id]: false },
    }));
    dispatch(
      {
        type: "campaign/set",
        ref: { id: ref.id, name: ref.name, hash, ...(ref.territory ? { territory: ref.territory } : {}) },
        merged: true,
      },
      mine.id,
    );
  }, [live, ref, merged, game.players, canControl, dispatch]);
  // An organiser's copy with an open event pairing for this table goes to the table by itself, so the
  // other players see the pairing at once (UX 225).
  useEffect(() => {
    if (!live || !ref || !edited || game.turn.round > 0) return;
    const book = books[ref.id];
    const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
    const mine = seated.find((p) => canControl(p.id));
    const hash = useCampaigns.getState().hashes[ref.id];
    if (
      !book?.event ||
      !mine ||
      !hash ||
      !openPairing(
        book,
        seated.map((p) => p.name),
      )
    )
      return;
    useCampaigns.setState((s) => ({ edited: { ...s.edited, [ref.id]: false } }));
    dispatch(
      {
        type: "campaign/set",
        ref: { id: ref.id, name: ref.name, hash, ...(ref.territory ? { territory: ref.territory } : {}) },
      },
      mine.id,
    );
  }, [live, ref, edited, books, game.turn.round, game.players, canControl, dispatch]);
  const shelf = useShelf((s) => s.armies);
  // Link each of this device's players to the shelf army they brought.
  useEffect(() => {
    if (!live || !ref) return;
    for (const [player, d] of Object.entries(deployed)) {
      if (!d.shelfId || !game.players[player] || !canControl(player)) continue;
      const link = ref.armies[player];
      const army = shelf[d.shelfId];
      const name = army?.name ?? d.roster.name;
      if (link?.armyId === d.shelfId && link.prefix === d.prefix && link.name === name) continue;
      // Named in the game, so every peer's book calls it the same (UX 201, 204).
      dispatch(
        {
          type: "campaign/army",
          player,
          armyId: d.shelfId,
          prefix: d.prefix,
          name,
          ...(army?.system ? { system: army.system } : {}),
        },
        player,
      );
    }
  }, [live, ref, deployed, shelf, game.players, canControl, dispatch]);
  // When the battle is over and scored, the game goes in the book.
  const scored = useMemo(
    () => !!ref && battleOver(game) && pendingScores(record, game, missionOf(game)).length === 0,
    [ref, game, record],
  );
  const asked = useRef(new Set<string>());
  // Campaign rules (24b, rules.ts): before the battle, and after it before it's recorded. The leader starts them.
  const over = scored && afterGameDone(record, game);
  useEffect(() => {
    if (!live || !ref || record.events.length === 0) return;
    const book = books[ref.id];
    const id = gameId(record);
    if (!book || !id || book.games.some((g) => g.id === id)) return;
    const first = sidePlayers(game, sides(game)[0] ?? 0)[0];
    if (!first || !canControl(first.id)) return;
    const next = scored
      ? nextCampaignHook("afterGame", book, record, game)
      : game.turn.round >= 1 && !battleOver(game)
        ? nextCampaignHook("beforeGame", book, record, game)
        : null;
    // Asked once per game: a client's request takes a moment to come back from the host.
    if (!next || next.type !== "script/start" || asked.current.has(`${id}:${next.procedure}`)) return;
    asked.current.add(`${id}:${next.procedure}`);
    dispatch(next, first.id);
  }, [live, ref, books, record, game, scored, canControl, dispatch]);
  useEffect(() => {
    if (!live || !over || !ref) return;
    const book = books[ref.id];
    const id = gameId(record);
    if (!book || !id || book.games.some((g) => g.id === id)) return;
    void saveReplay(id, record);
    // One peer leads: whoever plays the first side's first player. It writes the game into its copy
    // and points the game at it. The others write the same entry when their copy matched the
    // game's (the same bytes, from game state alone), or take the leader's copy when it didn't.
    const first = sidePlayers(game, sides(game)[0] ?? 0)[0];
    const leads = !!first && canControl(first.id);
    const matched = useCampaigns.getState().hashes[book.id] === ref.hash;
    if (!matched && !leads) return;
    useCampaigns.getState().put(recordGame(book, record, game, result(game)));
    if (leads) {
      const hash = useCampaigns.getState().hashes[book.id]!;
      dispatch(
        {
          type: "campaign/set",
          ref: { id: ref.id, name: ref.name, hash, ...(ref.territory ? { territory: ref.territory } : {}) },
          recorded: true,
        },
        first.id,
      );
    }
  }, [live, over, ref, books, record, game, canControl, dispatch]);
  return null;
}

function result(game: GameState) {
  const seats = sides(game);
  return { seats, vp: seats.map((seat) => game.resources[sidePlayers(game, seat)[0]?.id ?? ""]?.VP ?? 0) };
}

/** The menu's campaign fold: pick a book to play for, see whether copies match, set the stakes. */
export function CampaignFold() {
  const game = useStore((s) => s.game);
  const dispatch = useStore((s) => s.dispatch);
  const role = useStore((s) => s.role);
  const books = useCampaigns((s) => s.books);
  const transfers = useCampaignTransfers();
  const [naming, setNaming] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ref = game.campaign;
  const copy = useCopy();
  const edited = useCampaigns((s) => (ref ? !!s.edited[ref.id] : false));
  // A copy that differs opens the fold to say so; closing it is the player's call.
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (copy === "different" && edited && fold.current) fold.current.open = true;
  }, [copy, edited]);
  if (role === "spectator" && !ref) return null;
  const book = ref ? books[ref.id] : undefined;
  const seat = Object.values(game.players).find((p) => p.seat !== undefined);
  /** Point the game at this device's copy of a book (sharing it); it's then in step, not edited. */
  const play = (b: CampaignBook, territory?: string) => {
    useCampaigns.setState((s) => ({ edited: { ...s.edited, [b.id]: false } }));
    dispatch(
      {
        type: "campaign/set",
        ref: {
          id: b.id,
          name: b.name,
          hash: useCampaigns.getState().hashes[b.id]!,
          ...(territory ? { territory } : {}),
        },
      },
      seat?.id,
    );
    // The book's campaign rules come on with it, before the battle (UX 237).
    if (game.turn.round === 0)
      turnOnRules(
        game,
        rulesOff(b, game, useLibrary.getState().packages).flatMap((o) => (o.stored ? [o.stored] : [])),
      );
  };
  /** The place fought over: the game's copy of the book stays as it is. */
  const stake = (territory?: string) =>
    ref &&
    dispatch(
      {
        type: "campaign/set",
        ref: { id: ref.id, name: ref.name, hash: ref.hash, ...(territory ? { territory } : {}) },
      },
      seat?.id,
    );
  const create = () => {
    const name = naming?.trim();
    if (!name) return;
    const b = newCampaign(name);
    useCampaigns.getState().put(b);
    setNaming(null);
    play(b);
  };
  const openFile = async (file: File) => {
    let b: CampaignBook | null = null;
    try {
      b = readCampaign(JSON.parse(await file.text()));
    } catch {
      // Not a book.
    }
    if (!b) return setNote(t("That file isn't an Open Battle campaign book."));
    const here = useCampaigns.getState().books[b.id];
    if (here) {
      // Another player's copy of a book this device has (event night): join them, losing no game.
      const added = b.games.filter((g) => !here.games.some((x) => x.id === g.id)).length;
      useCampaigns.getState().put(mergeBooks(here, b), { edited: true });
      return setNote(
        added
          ? tn(
              added,
              "Added {n} game from that copy to your {book}.",
              "Added {n} games from that copy to your {book}.",
              {
                book: b.name,
              },
            )
          : t("Your {book} already had everything in that copy.", { book: b.name }),
      );
    }
    useCampaigns.getState().put(b);
    setNote(t("{book} is on this device.", { book: b.name }));
  };
  const getting = ref ? transfers[ref.hash] : undefined;

  return (
    <details className="fold campaign" ref={fold}>
      <summary>
        {ref ? t("Campaign: {book}", { book: ref.name }) : t("Campaign")}
        {copy === "different" ? " ⚠" : ""}
      </summary>
      {ref ? (
        <>
          {copy === "missing" && (
            <p className="muted">
              {getting?.state === "failed"
                ? t("The copy that came didn't match.")
                : t("Getting the campaign book from the table…")}{" "}
              <button className="small" onClick={() => requestCampaign(ref.hash)}>
                {t("Ask again")}
              </button>
            </p>
          )}
          {copy === "different" &&
            (edited && role !== "spectator" && book ? (
              <div className="warn-box">
                <p>
                  {t("You've changed your copy of {book}. Share it, so everyone's book says the same?", {
                    book: ref.name,
                  })}
                </p>
                <div className="row wrap">
                  <button className="primary" onClick={() => play(book, ref.territory)}>
                    {t("Share my copy")}
                  </button>
                  <button onClick={() => requestCampaign(ref.hash)}>{t("Undo my changes")}</button>
                </div>
              </div>
            ) : (
              // Unchanged here, so it's only behind: the game's copy is on its way (UX 202).
              <p className="muted">
                {transfers[ref.hash]?.state === "failed"
                  ? t("The copy of {book} that came didn't match.", { book: ref.name })
                  : t("Getting the latest {book} from the table…", { book: ref.name })}{" "}
                <button className="small" onClick={() => requestCampaign(ref.hash)}>
                  {t("Ask again")}
                </button>
              </p>
            ))}
          {book && (
            <div className="row wrap">
              <button onClick={() => useBookOpen.setState({ id: book.id })}>{t("Open the book")}</button>
              {role !== "spectator" && book.map.length > 0 && (
                <select
                  aria-label={t("Fighting over")}
                  value={ref.territory ?? ""}
                  onChange={(e) => stake(e.target.value || undefined)}
                >
                  <option value="">{t("Fighting over nowhere")}</option>
                  {book.map.map((place) => (
                    <option key={place.name} value={place.name}>
                      {place.holder
                        ? t("Fighting over {place} ({holder}'s)", { place: place.name, holder: place.holder })
                        : t("Fighting over {place}", { place: place.name })}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {book && <CampaignRulesLine book={book} game={game} />}
          <TerritoryTable territory={book?.map.find((t) => t.name === ref.territory)} />
          <Linked game={game} />
          {book && <EventLine book={book} game={game} />}
          {role !== "spectator" && (
            <button className="small" onClick={() => dispatch({ type: "campaign/set", ref: null }, seat?.id)}>
              {t("Stop playing for {book}", { book: ref.name })}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {t(
              "Play this game for a campaign book: the result, kills and honours go in it when the battle ends.",
            )}
          </p>
          <div className="row wrap">
            {Object.values(books).length > 0 && (
              <select
                aria-label={t("Play for a campaign")}
                value=""
                onChange={(e) => books[e.target.value] && play(books[e.target.value]!)}
              >
                <option value="">{t("Play for…")}</option>
                {Object.values(books).map((b) => (
                  <option key={b.id} value={b.id}>
                    {tn(b.games.length, "{book} ({n} game)", "{book} ({n} games)", { book: b.name })}
                  </option>
                ))}
              </select>
            )}
            {naming === null ? (
              <button onClick={() => setNaming("")}>{t("New campaign book")}</button>
            ) : (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <input
                  aria-label={t("Campaign name")}
                  placeholder={t("Campaign name")}
                  autoFocus
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                />
                <button className="primary" disabled={!naming.trim()}>
                  {t("Start the book")}
                </button>
              </form>
            )}
            <label className="file button">
              {t("Open a campaign file")}
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void openFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {note && <p className="muted">{note}</p>}
        </>
      )}
    </details>
  );
}

/** Before the battle: set up the table the place being fought over is played on, if it's in this device's library. */
function TerritoryTable({ territory }: { territory: Territory | undefined }) {
  const round = useStore((s) => s.game.turn.round);
  const role = useStore((s) => s.role);
  const table = useTables((s) => (territory?.table ? s.tables[territory.table.id] : undefined));
  if (!territory?.table || round > 0 || role === "spectator") return null;
  if (!table)
    return (
      <p className="muted small">
        {t("{place} is fought on {table}, which isn't in this device's table library.", {
          place: territory.name,
          table: territory.table.name,
        })}
      </p>
    );
  return (
    <button
      className="small"
      onClick={() => void applyLayout(table.layout, { key: `table:${table.id}`, name: table.name })}
    >
      {t("Set up {table} for {place}", { table: table.name, place: territory.name })}
    </button>
  );
}

/** Which army each player brought for the book; a player whose army isn't on their shelf is told how. */
function Linked({ game }: { game: GameState }) {
  const shelf = useShelf((s) => s.armies);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  const ref = game.campaign;
  if (!ref || !seated.length) return null;
  return (
    <ul className="campaign-armies">
      {seated.map((p) => {
        const link = ref.armies[p.id];
        return (
          <li key={p.id}>
            {p.name}:{" "}
            {link ? (
              (link.name ?? shelf[link.armyId]?.name ?? t("a shelf army"))
            ) : (
              <span className="muted">
                {t("no shelf army yet (save it to your shelf to track its units)")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A unit's campaign story on its card: kills, games, wounds carried, honours and scars. */
export function CampaignUnitLine({ unitId }: { unitId: string }) {
  const key = useStore((s) => campaignUnitKey(s.game, unitId));
  const id = useStore((s) => s.game.campaign?.id);
  const entry = useCampaigns((s) => (id && key ? s.books[id]?.units[key] : undefined));
  if (!entry) return null;
  return (
    <p className="campaign-unit">
      <strong>{t("Campaign:")}</strong> {tn(entry.kills, "{n} kill", "{n} kills")} ·{" "}
      {tn(entry.games, "survived {survived}/{n} game", "survived {survived}/{n} games", {
        survived: entry.survived,
      })}
      {entry.wounds ? " · " + tn(entry.wounds, "carrying {n} wound", "carrying {n} wounds") : ""}
      {entry.xp ? " · " + t("{n} XP", { n: entry.xp }) : ""}
      {entry.honours && (
        <span className="honours"> · {t("Honours: {honours}", { honours: entry.honours })}</span>
      )}
      {entry.scars && <span className="scars"> · {t("Scars: {scars}", { scars: entry.scars })}</span>}
    </p>
  );
}

type Tab = "league" | "event" | "games" | "units" | "map" | "notes";

/** The campaign book itself: league table, games, units, the map and notes, all editable on this device. */
export function CampaignBookDialog() {
  const id = useBookOpen((s) => s.id);
  const book = useCampaigns((s) => (id ? s.books[id] : undefined));
  const [tab, setTab] = useState<Tab>("league");
  const [replays, setReplays] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!id) return;
    void replayIds().then(setReplays);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useBookOpen.setState({ id: null });
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [id]);
  if (!book) return null;
  const save = (next: CampaignBook) => useCampaigns.getState().put(next, { edited: true });
  const close = () => useBookOpen.setState({ id: null });
  return (
    <div className="campaign-book" role="dialog" aria-label={t("Campaign book: {book}", { book: book.name })}>
      <div className="row spread">
        <input
          className="title"
          aria-label={t("Campaign name")}
          value={book.name}
          onChange={(e) => save({ ...book, name: e.target.value })}
        />
        <div className="row">
          <button onClick={() => saveJson(safeFileName(book.name, "campaign", ".campaign.json"), book)}>
            {t("Export")}
          </button>
          <button onClick={close} aria-label={t("Close")}>
            ✕
          </button>
        </div>
      </div>
      <p className="muted">
        {t(
          "Changes stay on this device until you share your copy in a game (Campaign in the menu), or send the exported file.",
        )}
      </p>
      <div className="tabs" role="tablist">
        {(["league", "event", "games", "units", "map", "notes"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "on" : ""}
            onClick={() => setTab(id)}
          >
            {
              {
                league: t("League"),
                event: t("Event"),
                games: t("Games"),
                units: t("Units"),
                map: t("Map"),
                notes: t("Notes"),
              }[id]
            }
          </button>
        ))}
      </div>
      <div className="body">
        {tab === "league" && <League book={book} />}
        {tab === "event" && <EventTab book={book} save={save} />}
        {tab === "games" && <Games book={book} replays={replays} />}
        {tab === "units" && <Units book={book} save={save} />}
        {tab === "map" && <MapTab book={book} save={save} />}
        {tab === "notes" && (
          <textarea
            aria-label={t("Campaign notes")}
            rows={10}
            value={book.notes}
            placeholder={t("The story so far, house rules, who owes who a drink…")}
            onChange={(e) => save({ ...book, notes: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

function League({ book }: { book: CampaignBook }) {
  const rows = leagueTable(book);
  if (!rows.length) return <p className="muted">{t("No one has played for this book yet.")}</p>;
  const armies = new Map(book.players.map((p) => [p.name, p.armies.map((a) => a.name).join(", ")]));
  return (
    <table className="league">
      <thead>
        <tr>
          <th>#</th>
          <th>{t("Player")}</th>
          <th title={t("Played")}>{tc("league table: games played", "P")}</th>
          <th title={t("Won")}>{tc("league table: games won", "W")}</th>
          <th title={t("Drawn")}>{tc("league table: games drawn", "D")}</th>
          <th title={t("Lost")}>{tc("league table: games lost", "L")}</th>
          <th title={t("Victory points scored and conceded")}>{t("VP")}</th>
          {book.map.length > 0 && <th title={t("Places held on the map")}>{t("Held")}</th>}
          <th title={t("3 for a win, 1 for a draw")}>{t("Pts")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.name}>
            <td>{i + 1}</td>
            <td>
              {r.name}
              {armies.get(r.name) && <span className="muted"> · {armies.get(r.name)}</span>}
            </td>
            <td>{r.played}</td>
            <td>{r.won}</td>
            <td>{r.drawn}</td>
            <td>{r.lost}</td>
            <td>
              {r.vpFor}–{r.vpAgainst}
            </td>
            {book.map.length > 0 && <td>{r.held}</td>}
            <td>
              <strong>{r.points}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Games({ book, replays }: { book: CampaignBook; replays: Set<string> }) {
  if (!book.games.length)
    return <p className="muted">{t("Games played for this book show here when they end.")}</p>;
  const watch = async (id: string) => {
    const record = await loadReplay(id);
    if (!record) return;
    useBookOpen.setState({ id: null });
    useStore.getState().openReplay(record);
  };
  return (
    <ol className="campaign-games" reversed>
      {[...book.games].reverse().map((g) => (
        <li key={g.id}>
          <div>
            <strong>
              {g.winner === null
                ? t("Draw")
                : t("{players} won", { players: g.sides[g.winner]?.players.join(" & ") ?? "" })}
            </strong>{" "}
            {t("{scores} VP", { scores: g.sides.map((s) => `${s.players.join(" & ")} ${s.vp}`).join(" – ") })}
          </div>
          <div className="muted">
            {formatDate(g.at)} ·{" "}
            {g.byHand ? (
              t("entered by hand")
            ) : (
              <>
                {systemLabel(g.system, systemName(g.system))}
                {g.mission ? ` · ${g.mission}` : ""} · {tn(g.rounds, "{n} round", "{n} rounds")}
              </>
            )}
            {g.territory ? " · " + t("for {place}", { place: g.territory }) : ""}
          </div>
          {!g.byHand && (
            <div className="muted">
              {g.sides
                .map((s) =>
                  t("{side}: {slain} slain, {lost} lost", {
                    side: s.armies.join(" & ") || s.players.join(" & "),
                    slain: s.slain,
                    lost: s.lost,
                  }),
                )
                .join(" · ")}
            </div>
          )}
          {replays.has(g.id) && (
            <button className="small" onClick={() => void watch(g.id)}>
              {t("Watch the replay")}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function Units({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  const [editing, setEditing] = useState(false);
  const entries = Object.entries(book.units);
  if (!entries.length)
    return (
      <p className="muted">
        {t(
          "Units show here after a game, when their army was brought from a shelf. Their kills, games and wounds fill in on their own; honours, scars and XP are yours to write, or your campaign rules add them.",
        )}
      </p>
    );
  const edit = (key: string, patch: Partial<CampaignUnit>) =>
    save({ ...book, units: { ...book.units, [key]: { ...book.units[key]!, ...patch } } });
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const byArmy = new Map<string, [string, CampaignUnit][]>();
  for (const e of entries) byArmy.set(e[1].army, [...(byArmy.get(e[1].army) ?? []), e]);
  return (
    <>
      <div className="row spread">
        <p className="muted small">
          {t(
            "Kills, games and wounds fill in after each game. Honours, scars and XP are yours to write, or your campaign rules add them.",
          )}
        </p>
        <button className={editing ? "small on" : "small"} onClick={() => setEditing(!editing)}>
          {editing ? t("Done editing") : t("Edit")}
        </button>
      </div>
      {[...byArmy].map(([army, units]) => (
        <section key={army}>
          <h4>{army}</h4>
          <table className="campaign-units">
            <thead>
              <tr>
                <th>{t("Unit")}</th>
                <th>{t("Kills")}</th>
                <th>{t("Games")}</th>
                <th>{t("Survived")}</th>
                <th>{t("Wounds carried")}</th>
                <th title={t("Experience, from campaign rules or written in")}>{t("XP")}</th>
                <th>{t("Honours")}</th>
                <th>{t("Scars")}</th>
              </tr>
            </thead>
            <tbody>
              {units.map(([key, u]) => (
                <tr key={key}>
                  <td>{u.name}</td>
                  {(["kills", "games", "survived", "wounds", "xp"] as const).map((f) => (
                    <td key={f}>
                      {/* Read as a record; numbers change only in Edit (UX 206). */}
                      {!editing ? (
                        (u[f] ?? 0)
                      ) : (
                        <input
                          type="number" // i18n-ignore: an input type
                          min={0}
                          aria-label={fieldLabel(f, u.name)}
                          value={u[f] ?? 0}
                          onChange={(e) => edit(key, { [f]: num(e.target.value) })}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    {editing ? (
                      <input
                        aria-label={t("{unit}: honours", { unit: u.name })}
                        value={u.honours}
                        onChange={(e) => edit(key, { honours: e.target.value })}
                      />
                    ) : (
                      u.honours || <span className="muted">–</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input
                        aria-label={t("{unit}: scars", { unit: u.name })}
                        value={u.scars}
                        onChange={(e) => edit(key, { scars: e.target.value })}
                      />
                    ) : (
                      u.scars || <span className="muted">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

/** A unit's number field, for its input's label. */
function fieldLabel(f: "kills" | "games" | "survived" | "wounds" | "xp", unit: string): string {
  switch (f) {
    case "kills":
      return t("{unit}: kills", { unit });
    case "games":
      return t("{unit}: games", { unit });
    case "survived":
      return t("{unit}: survived", { unit });
    case "wounds":
      return t("{unit}: wounds carried", { unit });
    case "xp":
      return t("{unit}: xp", { unit });
  }
}

function MapTab({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  const [name, setName] = useState("");
  const players = leagueTable(book).map((r) => r.name);
  const libraryTables = useTables((s) => s.tables);
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  const add = () => {
    const n = name.trim();
    if (!n || book.map.some((t) => t.name === n)) return;
    save({ ...book, map: [...book.map, { name: n }] });
    setName("");
  };
  return (
    <>
      <p className="muted">
        {t(
          "Places to fight over. Pick one under Campaign in the menu before a game, and the winner takes it.",
        )}
      </p>
      <ul className="campaign-map">
        {book.map.map((place, i) => (
          <li key={place.name} className={place.holder ? "held" : ""}>
            <span>{place.name}</span>
            <label className="small">
              {t("Held by")}{" "}
              <select
                aria-label={t("Who holds {place}", { place: place.name })}
                value={place.holder ?? ""}
                onChange={(e) =>
                  save({
                    ...book,
                    map: book.map.map((x, j) =>
                      j === i ? { name: x.name, ...(e.target.value ? { holder: e.target.value } : {}) } : x,
                    ),
                  })
                }
              >
                <option value="">{t("nobody")}</option>
                {players.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="small">
              {t("Played on")}{" "}
              <select
                aria-label={t("Table for {place}", { place: place.name })}
                value={place.table?.id ?? ""}
                onChange={(e) => {
                  const picked = libraryTables[e.target.value];
                  save({
                    ...book,
                    map: book.map.map((x, j) => {
                      if (j !== i) return x;
                      const { table: _t, ...rest } = x;
                      return picked ? { ...rest, table: { id: picked.id, name: picked.name } } : rest;
                    }),
                  });
                }}
              >
                <option value="">{t("any table")}</option>
                {place.table && !libraryTables[place.table.id] && (
                  <option value={place.table.id}>{place.table.name}</option>
                )}
                {Object.values(libraryTables).map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="small"
              aria-label={t("Remove {place}", { place: place.name })}
              onClick={() => save({ ...book, map: book.map.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label={t("New place")}
          placeholder={t("Hive Tertius, the Ash Wastes…")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={!name.trim()}>{t("Add a place")}</button>
      </form>
    </>
  );
}
