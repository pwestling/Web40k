import { useEffect, useMemo, useRef, useState } from "react";
import { sidePlayers, sides, type GameState } from "../core";
import { pendingScores } from "../missions/scoring";
import { getSystem } from "../core/content/systems";
import { useShelf } from "../packages/shelf";
import { useCanControl, useStore } from "../store";
import { missionOf } from "../ui/Missions";
import { download } from "../ui/report";
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
} from "./book";
import { requestCampaign, useCampaignSharing, useCampaignTransfers } from "./share";
import { loadReplay, replayIds, saveReplay, useCampaigns } from "./store";
import { create } from "zustand";

/** Which book is open on screen. */
const useBookOpen = create<{ id: string | null }>(() => ({ id: null }));

const systemName = (id: string) => {
  try {
    return getSystem(id).name;
  } catch {
    return id;
  }
};

const fileName = (name: string) =>
  `${
    name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "campaign"
  }.campaign.json`;

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
  useEffect(() => {
    if (live && ref && copy === "missing") requestCampaign(ref.hash);
  }, [live, ref, copy]);
  // Link each of this device's players to the shelf army they brought.
  useEffect(() => {
    if (!live || !ref) return;
    for (const [player, d] of Object.entries(deployed)) {
      if (!d.shelfId || !game.players[player] || !canControl(player)) continue;
      const link = ref.armies[player];
      if (link?.armyId === d.shelfId && link.prefix === d.prefix) continue;
      dispatch({ type: "campaign/army", player, armyId: d.shelfId, prefix: d.prefix }, player);
    }
  }, [live, ref, deployed, game.players, canControl, dispatch]);
  // When the battle is over and scored, the game goes in the book.
  const over = useMemo(
    () => !!ref && battleOver(game) && pendingScores(record, game, missionOf(game)).length === 0,
    [ref, game, record],
  );
  useEffect(() => {
    if (!live || !over || !ref) return;
    const book = books[ref.id];
    const id = gameId(record);
    if (!book || !id || book.games.some((g) => g.id === id)) return;
    const matched = useCampaigns.getState().hashes[book.id] === ref.hash;
    const next = recordGame(book, record, game, result(game), shelfSummary());
    useCampaigns.getState().put(next);
    void saveReplay(id, record);
    // One peer moves the game on to the new copy: whoever plays the first side's first player.
    const first = sidePlayers(game, sides(game)[0] ?? 0)[0];
    if (matched && first && canControl(first.id)) {
      const hash = useCampaigns.getState().hashes[book.id]!;
      dispatch(
        {
          type: "campaign/set",
          ref: { id: ref.id, name: ref.name, hash, ...(ref.territory ? { territory: ref.territory } : {}) },
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

function shelfSummary() {
  return Object.fromEntries(
    Object.values(useShelf.getState().armies).map((a) => [a.id, { name: a.name, system: a.system }]),
  );
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
    if (copy === "different" && fold.current) fold.current.open = true;
  }, [copy]);
  if (role === "spectator" && !ref) return null;
  const book = ref ? books[ref.id] : undefined;
  const seat = Object.values(game.players).find((p) => p.seat !== undefined);
  const play = (b: CampaignBook, territory?: string) =>
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
    if (!b) return setNote("That file isn't an Open Battle campaign book.");
    useCampaigns.getState().put(b);
    setNote(`${b.name} is on this device.`);
  };
  const getting = ref ? transfers[ref.hash] : undefined;

  return (
    <details className="fold campaign" ref={fold}>
      <summary>
        Campaign{ref ? `: ${ref.name}` : ""}
        {copy === "different" ? " ⚠" : ""}
      </summary>
      {ref ? (
        <>
          {copy === "missing" && (
            <p className="muted">
              {getting?.state === "failed"
                ? "The copy that came didn't match. "
                : "Getting the campaign book from the table… "}
              <button className="small" onClick={() => requestCampaign(ref.hash)}>
                Ask again
              </button>
            </p>
          )}
          {copy === "different" &&
            (edited && role !== "spectator" && book ? (
              <div className="warn-box">
                <p>You've changed your copy of {ref.name}. Share it, so everyone's book says the same?</p>
                <div className="row wrap">
                  <button className="primary" onClick={() => play(book, ref.territory)}>
                    Share my copy
                  </button>
                  <button onClick={() => requestCampaign(ref.hash)}>Undo my changes</button>
                </div>
              </div>
            ) : (
              <div className="warn-box" role="alert">
                <p>Your copy of {ref.name} isn't the same as the one this game uses.</p>
                <div className="row wrap">
                  <button className="primary" onClick={() => requestCampaign(ref.hash)}>
                    Use the game's copy
                  </button>
                  {role !== "spectator" && book && (
                    <button onClick={() => play(book, ref.territory)}>Share my copy</button>
                  )}
                </div>
              </div>
            ))}
          {book && (
            <div className="row wrap">
              <button onClick={() => useBookOpen.setState({ id: book.id })}>Open the book</button>
              {role !== "spectator" && book.map.length > 0 && (
                <select
                  aria-label="Fighting over"
                  value={ref.territory ?? ""}
                  onChange={(e) => play(book, e.target.value || undefined)}
                >
                  <option value="">Fighting over nowhere</option>
                  {book.map.map((t) => (
                    <option key={t.name} value={t.name}>
                      Fighting over {t.name}
                      {t.holder ? ` (${t.holder}'s)` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <Linked game={game} />
          {role !== "spectator" && (
            <button className="small" onClick={() => dispatch({ type: "campaign/set", ref: null }, seat?.id)}>
              Stop playing for {ref.name}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Play this game for a campaign book: the result, kills and honours go in it when the battle ends.
          </p>
          <div className="row wrap">
            {Object.values(books).length > 0 && (
              <select
                aria-label="Play for a campaign"
                value=""
                onChange={(e) => books[e.target.value] && play(books[e.target.value]!)}
              >
                <option value="">Play for…</option>
                {Object.values(books).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.games.length} game{b.games.length === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            )}
            {naming === null ? (
              <button onClick={() => setNaming("")}>New campaign book</button>
            ) : (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <input
                  aria-label="Campaign name"
                  placeholder="Campaign name"
                  autoFocus
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                />
                <button className="primary" disabled={!naming.trim()}>
                  Start the book
                </button>
              </form>
            )}
            <label className="file button">
              Open a campaign file
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
              (shelf[link.armyId]?.name ?? "their shelf army")
            ) : (
              <span className="muted">no shelf army yet (save it to your shelf to track its units)</span>
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
      <strong>Campaign:</strong> {entry.kills} kill{entry.kills === 1 ? "" : "s"} · survived {entry.survived}/
      {entry.games} game{entry.games === 1 ? "" : "s"}
      {entry.wounds ? ` · carrying ${entry.wounds} wound${entry.wounds === 1 ? "" : "s"}` : ""}
      {entry.honours && <span className="honours"> · Honours: {entry.honours}</span>}
      {entry.scars && <span className="scars"> · Scars: {entry.scars}</span>}
    </p>
  );
}

type Tab = "league" | "games" | "units" | "map" | "notes";

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
    <div className="campaign-book" role="dialog" aria-label={`Campaign book: ${book.name}`}>
      <div className="row spread">
        <input
          className="title"
          aria-label="Campaign name"
          value={book.name}
          onChange={(e) => save({ ...book, name: e.target.value })}
        />
        <div className="row">
          <button onClick={() => download(fileName(book.name), book)}>Export</button>
          <button onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <p className="muted">
        Changes stay on this device until you share your copy in a game (Campaign in the menu), or send the
        exported file.
      </p>
      <div className="tabs" role="tablist">
        {(["league", "games", "units", "map", "notes"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {{ league: "League", games: "Games", units: "Units", map: "Map", notes: "Notes" }[t]}
          </button>
        ))}
      </div>
      <div className="body">
        {tab === "league" && <League book={book} />}
        {tab === "games" && <Games book={book} replays={replays} />}
        {tab === "units" && <Units book={book} save={save} />}
        {tab === "map" && <MapTab book={book} save={save} />}
        {tab === "notes" && (
          <textarea
            aria-label="Campaign notes"
            rows={10}
            value={book.notes}
            placeholder="The story so far, house rules, who owes who a drink…"
            onChange={(e) => save({ ...book, notes: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

function League({ book }: { book: CampaignBook }) {
  const rows = leagueTable(book);
  if (!rows.length) return <p className="muted">No one has played for this book yet.</p>;
  const armies = new Map(book.players.map((p) => [p.name, p.armies.map((a) => a.name).join(", ")]));
  return (
    <table className="league">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th title="Played">P</th>
          <th title="Won">W</th>
          <th title="Drawn">D</th>
          <th title="Lost">L</th>
          <th title="Victory points scored and conceded">VP</th>
          {book.map.length > 0 && <th title="Places held on the map">Held</th>}
          <th title="3 for a win, 1 for a draw">Pts</th>
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
  if (!book.games.length) return <p className="muted">Games played for this book show here when they end.</p>;
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
            <strong>{g.winner === null ? "Draw" : `${g.sides[g.winner]?.players.join(" & ")} won`}</strong>{" "}
            {g.sides.map((s) => `${s.players.join(" & ")} ${s.vp}`).join(" – ")} VP
          </div>
          <div className="muted">
            {new Date(g.at).toLocaleDateString()} · {systemLabel(g.system, systemName(g.system))}
            {g.mission ? ` · ${g.mission}` : ""} · {g.rounds} round{g.rounds === 1 ? "" : "s"}
            {g.territory ? ` · for ${g.territory}` : ""}
          </div>
          <div className="muted">
            {g.sides
              .map(
                (s) => `${s.armies.join(" & ") || s.players.join(" & ")}: ${s.slain} slain, ${s.lost} lost`,
              )
              .join(" · ")}
          </div>
          {replays.has(g.id) && (
            <button className="small" onClick={() => void watch(g.id)}>
              Watch the replay
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function Units({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  const entries = Object.entries(book.units);
  if (!entries.length)
    return (
      <p className="muted">
        Units show here after a game, when their army was brought from a shelf. Their kills, games and wounds
        fill in on their own; honours and scars are yours to write.
      </p>
    );
  const edit = (key: string, patch: Partial<CampaignUnit>) =>
    save({ ...book, units: { ...book.units, [key]: { ...book.units[key]!, ...patch } } });
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const byArmy = new Map<string, [string, CampaignUnit][]>();
  for (const e of entries) byArmy.set(e[1].army, [...(byArmy.get(e[1].army) ?? []), e]);
  return (
    <>
      {[...byArmy].map(([army, units]) => (
        <section key={army}>
          <h4>{army}</h4>
          <table className="campaign-units">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Kills</th>
                <th>Games</th>
                <th>Survived</th>
                <th>Wounds carried</th>
                <th>Honours</th>
                <th>Scars</th>
              </tr>
            </thead>
            <tbody>
              {units.map(([key, u]) => (
                <tr key={key}>
                  <td>{u.name}</td>
                  {(["kills", "games", "survived", "wounds"] as const).map((f) => (
                    <td key={f}>
                      <input
                        type="number"
                        min={0}
                        aria-label={`${u.name}: ${f === "wounds" ? "wounds carried" : f}`}
                        value={u[f]}
                        onChange={(e) => edit(key, { [f]: num(e.target.value) })}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      aria-label={`${u.name}: honours`}
                      value={u.honours}
                      onChange={(e) => edit(key, { honours: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${u.name}: scars`}
                      value={u.scars}
                      onChange={(e) => edit(key, { scars: e.target.value })}
                    />
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

function MapTab({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  const [name, setName] = useState("");
  const players = leagueTable(book).map((r) => r.name);
  const add = () => {
    const n = name.trim();
    if (!n || book.map.some((t) => t.name === n)) return;
    save({ ...book, map: [...book.map, { name: n }] });
    setName("");
  };
  return (
    <>
      <p className="muted">
        Places to fight over. Pick one under Campaign in the menu before a game, and the winner takes it.
      </p>
      <ul className="campaign-map">
        {book.map.map((t, i) => (
          <li key={t.name} className={t.holder ? "held" : ""}>
            <span>{t.name}</span>
            <select
              aria-label={`Who holds ${t.name}`}
              value={t.holder ?? ""}
              onChange={(e) =>
                save({
                  ...book,
                  map: book.map.map((x, j) =>
                    j === i ? { name: x.name, ...(e.target.value ? { holder: e.target.value } : {}) } : x,
                  ),
                })
              }
            >
              <option value="">Nobody holds it</option>
              {players.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              className="small"
              aria-label={`Remove ${t.name}`}
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
          aria-label="New place"
          placeholder="Hive Tertius, the Ash Wastes…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={!name.trim()}>Add a place</button>
      </form>
    </>
  );
}
