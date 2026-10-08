import { useEffect, useState } from "react";
import type { GameState } from "../core";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { applyLayout } from "../tables/actions";
import { useTables } from "../tables/library";
import { useStore } from "../store";
import { gameId, leagueTable, type CampaignBook, type CampaignGame } from "./book";
import {
  handResult,
  newEvent,
  openPairing,
  pairingTable,
  pairNextRound,
  roundDone,
  standings,
  type CampaignEvent,
  type EventPairing,
} from "./event";

/** The book's Event tab: set up an event night, then its standings, rounds and results. */
export function EventTab({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  return book.event ? (
    <Running book={book} event={book.event} save={save} />
  ) : (
    <Setup book={book} save={save} />
  );
}

function Setup({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  const known = leagueTable(book).map((r) => r.name);
  const [entrants, setEntrants] = useState<string[]>(known);
  const [extra, setExtra] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [rounds, setRounds] = useState(3);
  const library = useTables((s) => s.tables);
  const [tables, setTables] = useState<string[]>([]);
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  const everyone = [...known, ...extra];
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const add = () => {
    const name = adding.trim();
    if (!name || everyone.includes(name)) return setAdding("");
    setExtra([...extra, name]);
    setEntrants([...entrants, name]);
    setAdding("");
  };
  const start = () => {
    const picked = tables.flatMap((id) => (library[id] ? [{ id, name: library[id].name }] : []));
    const draft = { ...book, event: newEvent(entrants, rounds, picked) };
    save({ ...draft, event: { ...draft.event, pairings: [pairNextRound(draft)] } });
  };
  return (
    <div className="event-setup">
      <p className="muted">
        Run an event night in this book: Swiss rounds, where each round pairs players on the same score and
        nobody meets the same opponent twice. Games played for this book settle their pairing when they end.
      </p>
      <fieldset>
        <legend>Players ({entrants.length})</legend>
        <div className="row wrap">
          {everyone.map((n) => (
            <label key={n} className="check">
              <input
                type="checkbox"
                checked={entrants.includes(n)}
                onChange={() => setEntrants(toggle(entrants, n))}
              />{" "}
              {n}
            </label>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="Add a player"
            placeholder="Add a player"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <button className="small" disabled={!adding.trim()}>
            Add
          </button>
        </form>
        <p className="muted small">
          Use the names players go by at the table, so their games find their pairing.
        </p>
      </fieldset>
      <label>
        Rounds{" "}
        <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Tables</legend>
        {Object.values(library).length ? (
          <div className="row wrap">
            {Object.values(library)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={tables.includes(t.id)}
                    onChange={() => setTables(toggle(tables, t.id))}
                  />{" "}
                  {t.name}
                </label>
              ))}
          </div>
        ) : (
          <p className="muted small">
            No tables in your library yet: save one in Edit terrain to play the event on it.
          </p>
        )}
        {tables.length > 0 && (
          <p className="muted small">
            Table 1 plays on {library[tables[0]!]?.name}
            {tables.length > 1
              ? `, table 2 on ${library[tables[1]!]?.name}, and so on`
              : ", and so does every table"}
            .
          </p>
        )}
      </fieldset>
      <button className="primary" disabled={entrants.length < 2} onClick={start}>
        Start the event and pair round 1
      </button>
    </div>
  );
}

function Running({
  book,
  event,
  save,
}: {
  book: CampaignBook;
  event: CampaignEvent;
  save: (b: CampaignBook) => void;
}) {
  const rows = standings(book);
  const games = new Map(book.games.map((g) => [g.id, g]));
  const current = event.pairings.length - 1;
  const done = current >= 0 && roundDone(book, current);
  const over = done && event.pairings.length >= event.rounds;
  const started = event.pairings[current]?.some((p) => p.game) ?? false;
  const withEvent = (e: CampaignEvent) => save({ ...book, event: e });
  const pairNext = () => withEvent({ ...event, pairings: [...event.pairings, pairNextRound(book)] });
  const repair = () => {
    const before = { ...book, event: { ...event, pairings: event.pairings.slice(0, -1) } };
    withEvent({ ...event, pairings: [...before.event.pairings, pairNextRound(before)] });
  };
  const drop = (name: string, out: boolean) =>
    withEvent({
      ...event,
      dropped: out ? [...event.dropped, name] : event.dropped.filter((n) => n !== name),
    });
  const system = book.games.at(-1)?.system ?? DEFAULT_SYSTEM;
  return (
    <div className="event">
      <p>
        <strong>
          {over
            ? `The event is over: ${rows[0]?.name} wins.`
            : `Round ${current + 1} of ${event.rounds}${done ? ": every result is in." : "."}`}
        </strong>{" "}
        {!over && done && (
          <button className="primary small" onClick={pairNext}>
            Pair round {current + 2}
          </button>
        )}
        {!done && !started && current >= 0 && (
          <button className="small" onClick={repair} title="Draw this round again, e.g. after someone drops">
            Pair this round again
          </button>
        )}
      </p>
      <table className="league">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th title="Won, drawn, lost">W-D-L</th>
            <th title="Victory points scored and conceded">VP</th>
            <th title="Strength of schedule: the points of everyone they played">SoS</th>
            <th title="3 for a win or a bye, 1 for a draw">Pts</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={r.dropped ? "muted" : undefined}>
              <td>{i + 1}</td>
              <td>
                {r.name}
                {r.byes ? <span className="muted"> · bye</span> : null}
                {r.dropped ? <span className="muted"> · dropped</span> : null}
              </td>
              <td>
                {r.won}-{r.drawn}-{r.lost}
              </td>
              <td>
                {r.vpFor}–{r.vpAgainst}
              </td>
              <td>{r.sos}</td>
              <td>
                <strong>{r.points}</strong>
              </td>
              <td>
                {!over && (
                  <button
                    className="small link"
                    onClick={() => drop(r.name, !r.dropped)}
                    title={
                      r.dropped
                        ? "Pair them again from next round"
                        : "Not paired from next round; their results stand"
                    }
                  >
                    {r.dropped ? "Back in" : "Drop"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {[...event.pairings].reverse().map((round, back) => {
        const r = event.pairings.length - 1 - back;
        return (
          <section key={r} className="event-round">
            <h4>Round {r + 1}</h4>
            <ul>
              {round.map((p) => (
                <PairingRow
                  key={p.table}
                  pairing={p}
                  table={pairingTable(event, p)?.name}
                  game={p.game ? games.get(p.game) : undefined}
                  enter={(vp) => save(handResult(book, r, p, vp, system))}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <p>
        <button
          className="small danger"
          onClick={() => {
            if (confirm("Take the event out of this book? Its games stay in the book.")) {
              const { event: _e, ...rest } = book;
              save(rest);
            }
          }}
        >
          Remove the event
        </button>
      </p>
    </div>
  );
}

function PairingRow({
  pairing,
  table,
  game,
  enter,
}: {
  pairing: EventPairing;
  table: string | undefined;
  game: CampaignGame | undefined;
  enter: (vp: [number, number]) => void;
}) {
  const [typing, setTyping] = useState<[string, string] | null>(null);
  const where = `Table ${pairing.table}${table ? ` · ${table}` : ""}`;
  if (pairing.players.length === 1)
    return (
      <li>
        <span className="muted">{where.split(" · ")[0]}:</span> {pairing.players[0]} has a bye (3 points)
      </li>
    );
  const [a, b] = pairing.players as [string, string];
  const vpOf = (name: string) => game?.sides.find((s) => s.players.includes(name))?.vp ?? 0;
  const winner = game && game.winner !== null ? game.sides[game.winner]?.players[0] : null;
  return (
    <li>
      <span className="muted">{where}:</span> {a} vs {b}
      {game ? (
        <>
          {" · "}
          <strong>{winner ? `${winner} won` : "Draw"}</strong> {vpOf(a)}–{vpOf(b)}
          {game.byHand && <span className="muted"> (entered by hand)</span>}
        </>
      ) : typing ? (
        <form
          className="row hand-result"
          onSubmit={(e) => {
            e.preventDefault();
            enter([Number(typing[0]) || 0, Number(typing[1]) || 0]);
            setTyping(null);
          }}
        >
          <label>
            {a}{" "}
            <input
              type="number"
              min={0}
              aria-label={`${a}'s VP`}
              value={typing[0]}
              onChange={(e) => setTyping([e.target.value, typing[1]])}
            />
          </label>
          <label>
            {b}{" "}
            <input
              type="number"
              min={0}
              aria-label={`${b}'s VP`}
              value={typing[1]}
              onChange={(e) => setTyping([typing[0], e.target.value])}
            />
          </label>
          <button className="small primary">Save the result</button>
          <button type="button" className="small" onClick={() => setTyping(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {" · "}
          <span className="muted">waiting for the result</span>{" "}
          <button
            className="small link"
            onClick={() => setTyping(["", ""])}
            title="For a game played off the app"
          >
            Enter it by hand
          </button>
        </>
      )}
    </li>
  );
}

/** In the menu's campaign fold: the event pairing this game settles, and its table to set up. */
export function EventLine({ book, game }: { book: CampaignBook; game: GameState }) {
  const role = useStore((s) => s.role);
  const library = useTables((s) => s.tables);
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  const record = useStore((s) => s.record);
  const id = gameId(record);
  // This game is in the book already: it settled its pairing (or didn't count), and the next round isn't it.
  if (!book.event || (id && book.games.some((g) => g.id === id))) return null;
  const names = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .map((p) => p.name);
  const open = openPairing(book, names);
  const settled = book.event.pairings.length && !open;
  if (!open)
    return settled ? (
      <p className="muted small">
        {book.name} is running an event: round {book.event.pairings.length}. This game's players aren't an
        open pairing in it, so it won't count for the event (rename players to match the pairings).
      </p>
    ) : null;
  const table = pairingTable(book.event, open.pairing);
  const here = table ? library[table.id] : undefined;
  const set = game.tableSource?.key === `table:${table?.id}` && !game.tableSource.changed;
  return (
    <div className="event-line">
      <p>
        Event round {open.round + 1}, table {open.pairing.table}: {open.pairing.players.join(" vs ")}
        {table ? ` on ${table.name}` : ""}. The result goes in when the battle ends.
      </p>
      {table &&
        game.turn.round === 0 &&
        role !== "spectator" &&
        !set &&
        (here ? (
          <button
            className="small"
            onClick={() => void applyLayout(here.layout, { key: `table:${here.id}`, name: here.name })}
          >
            Set up {here.name}
          </button>
        ) : (
          <p className="muted small">
            {table.name} isn't in this device's table library: whoever has it can set it up.
          </p>
        ))}
    </div>
  );
}
