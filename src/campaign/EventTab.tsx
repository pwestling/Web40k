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
  setDropped,
  openPairing,
  pairingTable,
  pairNextRound,
  roundDone,
  standings,
  type CampaignEvent,
  type EventPairing,
} from "./event";
import { t, tn } from "../i18n";

/** The book's Event tab: set up an event night, then its standings, rounds and results. */
export function EventTab({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  return book.event ? (
    <Running book={book} event={book.event} save={save} />
  ) : (
    <Setup book={book} save={save} />
  );
}

function Setup({ book, save }: { book: CampaignBook; save: (b: CampaignBook) => void }) {
  // The people at this table first (UX 220), then everyone who has played for the book.
  const players = useStore((s) => s.game.players);
  const here = Object.values(players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!)
    .map((p) => p.name);
  const known = [...new Set([...here, ...leagueTable(book).map((r) => r.name)])];
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
        {t(
          "Run an event night in this book: Swiss rounds, where each round pairs players on the same score and nobody meets the same opponent twice. Games played for this book settle their pairing when they end.",
        )}
      </p>
      <fieldset>
        <legend>{t("Players ({n})", { n: entrants.length })}</legend>
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
            aria-label={t("Add a player")}
            placeholder={t("Add a player")}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <button className="small" disabled={!adding.trim()}>
            {t("Add")}
          </button>
        </form>
        <p className="muted small">
          {t("Use the names players go by at the table, so their games find their pairing.")}
        </p>
      </fieldset>
      <label>
        {t("Rounds")}{" "}
        <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{t("Tables")}</legend>
        {Object.values(library).length ? (
          <div className="row wrap">
            {Object.values(library)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((tbl) => (
                <label key={tbl.id} className="check">
                  <input
                    type="checkbox"
                    checked={tables.includes(tbl.id)}
                    onChange={() => setTables(toggle(tables, tbl.id))}
                  />{" "}
                  {tbl.name}
                </label>
              ))}
          </div>
        ) : (
          <p className="muted small">
            {t("No tables in your library yet: save one in Edit terrain to play the event on it.")}
          </p>
        )}
        {tables.length > 0 && (
          <p className="muted small">
            {tables.length > 1
              ? t("Table 1 plays on {first}, table 2 on {second}, and so on.", {
                  first: library[tables[0]!]?.name,
                  second: library[tables[1]!]?.name,
                })
              : t("Table 1 plays on {first}, and so does every table.", { first: library[tables[0]!]?.name })}
          </p>
        )}
      </fieldset>
      <button className="primary" disabled={entrants.length < 2} onClick={start}>
        {t("Start the event and pair round 1")}
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
  const withEvent = (e: CampaignEvent) => save({ ...book, event: e });
  const pairNext = () => withEvent({ ...event, pairings: [...event.pairings, pairNextRound(book)] });
  const results = (event.pairings[current] ?? []).filter((p) => p.game).length;
  const repair = (changed: CampaignEvent = event) => {
    // A result already entered for this round is thrown away by drawing it again: ask first (UX 222).
    if (
      results &&
      !confirm(
        tn(
          results,
          "Pairing round {round} again throws away {n} result entered for it (the games stay in the book). Pair it again?",
          "Pairing round {round} again throws away {n} results entered for it (the games stay in the book). Pair it again?",
          { round: current + 1 },
        ),
      )
    )
      return;
    const before = { ...book, event: { ...changed, pairings: changed.pairings.slice(0, -1) } };
    const conflicts = (changed.conflicts ?? []).filter((r) => r !== current);
    withEvent({
      ...changed,
      conflicts,
      pairings: [...before.event.pairings, pairNextRound(before)],
    });
    setAfterDrop(null);
  };
  // After a drop or a back-in, the round as drawn may not fit any more: offer to draw it again.
  const [afterDrop, setAfterDrop] = useState<{ name: string; out: boolean } | null>(null);
  const drop = (name: string, out: boolean) => {
    withEvent(setDropped(event, name, out));
    const inRound = (event.pairings[current] ?? []).some((p) => p.players.includes(name));
    if (!done && current >= 0 && inRound === out) setAfterDrop({ name, out });
  };
  const system = book.games.at(-1)?.system ?? DEFAULT_SYSTEM;
  return (
    <div className="event">
      <p>
        <strong>
          {over
            ? t("The event is over: {player} wins.", { player: rows[0]?.name })
            : done
              ? t("Round {round} of {rounds}: every result is in.", {
                  round: current + 1,
                  rounds: event.rounds,
                })
              : t("Round {round} of {rounds}.", { round: current + 1, rounds: event.rounds })}
        </strong>{" "}
        {!over && done && (
          <button className="primary small" onClick={pairNext}>
            {t("Pair round {round}", { round: current + 2 })}
          </button>
        )}
        {!done && current >= 0 && !afterDrop && (
          <button
            className="small"
            onClick={() => repair()}
            title={t("Draw this round again, e.g. after someone drops")}
          >
            {t("Pair this round again")}
          </button>
        )}
      </p>
      {afterDrop && (
        <div className="warn-box">
          <p>
            {afterDrop.out
              ? t("{player} is still paired in round {round}. Pair round {round} again without {player}?", {
                  player: afterDrop.name,
                  round: current + 1,
                })
              : t("{player} isn't paired in round {round}. Pair round {round} again with {player}?", {
                  player: afterDrop.name,
                  round: current + 1,
                })}
          </p>
          <div className="row">
            <button className="small primary" onClick={() => repair()}>
              {t("Pair round {round} again", { round: current + 1 })}
            </button>
            <button className="small" onClick={() => setAfterDrop(null)}>
              {t("Keep the pairings")}
            </button>
          </div>
        </div>
      )}
      {(event.conflicts ?? []).length > 0 && (
        <p className="warn small">
          {tn(
            event.conflicts!.length,
            "Another copy of this book paired round {rounds} differently. Games played on those pairings are in the Games tab but not here: enter them by hand if they should count.",
            "Another copy of this book paired rounds {rounds} differently. Games played on those pairings are in the Games tab but not here: enter them by hand if they should count.",
            { rounds: event.conflicts!.map((r) => r + 1).join(", ") },
          )}
        </p>
      )}
      <table className="league">
        <thead>
          <tr>
            <th>#</th>
            <th>{t("Player")}</th>
            <th title={t("Won, drawn, lost")}>{t("W-D-L")}</th>
            <th title={t("Victory points scored and conceded")}>{t("VP")}</th>
            <th title={t("Strength of schedule: the points of everyone they played")}>{t("SoS")}</th>
            <th title={t("3 for a win or a bye, 1 for a draw")}>{t("Pts")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={r.dropped ? "muted" : undefined}>
              <td>{i + 1}</td>
              <td>
                {r.name}
                {r.byes ? <span className="muted"> · {t("bye")}</span> : null}
                {r.dropped ? <span className="muted"> · {t("dropped")}</span> : null}
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
                        ? t("Pair them again from next round")
                        : t("Not paired from next round; their results stand")
                    }
                  >
                    {r.dropped ? t("Back in") : t("Drop")}
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
            <h4>{t("Round {n}", { n: r + 1 })}</h4>
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
            if (confirm(t("Take the event out of this book? Its games stay in the book."))) {
              const { event: _e, ...rest } = book;
              save(rest);
            }
          }}
        >
          {t("Remove the event")}
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
  const tableNo = t("Table {n}", { n: pairing.table });
  const where = table ? `${tableNo} · ${table}` : tableNo;
  if (pairing.players.length === 1)
    return (
      <li>
        <span className="muted">{tableNo}:</span>{" "}
        {t("{player} has a bye (3 points)", { player: pairing.players[0] })}
      </li>
    );
  const [a, b] = pairing.players as [string, string];
  const vpOf = (name: string) => game?.sides.find((s) => s.players.includes(name))?.vp ?? 0;
  const winner = game && game.winner !== null ? game.sides[game.winner]?.players[0] : null;
  // The winner's score first: "Cy won 2–0" (UX 221).
  const [first, second] = winner === b ? [b, a] : [a, b];
  return (
    <li>
      <span className="muted">{where}:</span> {t("{a} vs {b}", { a, b })}
      {game ? (
        <>
          {" · "}
          <strong>{winner ? t("{players} won", { players: winner }) : t("Draw")}</strong> {vpOf(first)}–
          {vpOf(second)}
          {game.byHand && <span className="muted"> ({t("entered by hand")})</span>}
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
              aria-label={t("{player}'s VP", { player: a })}
              value={typing[0]}
              onChange={(e) => setTyping([e.target.value, typing[1]])}
            />
          </label>
          <label>
            {b}{" "}
            <input
              type="number"
              min={0}
              aria-label={t("{player}'s VP", { player: b })}
              value={typing[1]}
              onChange={(e) => setTyping([typing[0], e.target.value])}
            />
          </label>
          <button className="small primary">{t("Save the result")}</button>
          <button type="button" className="small" onClick={() => setTyping(null)}>
            {t("Cancel")}
          </button>
        </form>
      ) : (
        <>
          {" · "}
          <span className="muted">{t("waiting for the result")}</span>{" "}
          <button
            className="small link"
            onClick={() => setTyping(["", ""])}
            title={t("For a game played off the app")}
          >
            {t("Enter it by hand")}
          </button>
        </>
      )}
    </li>
  );
}

/** "Ana vs Bo". */
const versus = (players: string[]) => players.reduce((a, b) => t("{a} vs {b}", { a, b }));

/** In the menu's campaign fold: the event pairing this game settles, and its table to set up. */
export function EventLine({ book, game }: { book: CampaignBook; game: GameState }) {
  const role = useStore((s) => s.role);
  const library = useTables((s) => s.tables);
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  const record = useStore((s) => s.record);
  const id = gameId(record);
  if (!book.event) return null;
  // This game is in the book already: say what it counted for, if anything (UX 223).
  const counted = id ? book.games.find((g) => g.id === id) : undefined;
  if (counted) {
    const at = book.event.pairings.flatMap((round, r) =>
      round.flatMap((p) => (p.game === counted.id ? [{ r, p }] : [])),
    )[0];
    if (!at) return null;
    const won = counted.winner === null ? null : counted.sides[counted.winner];
    const lost = counted.sides.find((s) => s !== won);
    return (
      <p className="muted small">
        {t("Counted for event round {round}, table {table}: {result}.", {
          round: at.r + 1,
          table: at.p.table,
          result: won
            ? t("{players} won {score}", {
                players: won.players.join(" & "),
                score: `${won.vp}–${lost?.vp ?? 0}`,
              })
            : t("a draw, {score}", { score: counted.sides.map((s) => s.vp).join("–") }),
        })}
      </p>
    );
  }
  const names = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .map((p) => p.name);
  const open = openPairing(book, names);
  const settled = book.event.pairings.length && !open;
  if (!open)
    return settled ? (
      <p className="muted small">
        {t(
          "{book} is running an event: round {round}. This game's players aren't an open pairing in it, so it won't count for the event (rename players to match the pairings).",
          { book: book.name, round: book.event.pairings.length },
        )}
      </p>
    ) : null;
  const table = pairingTable(book.event, open.pairing);
  const here = table ? library[table.id] : undefined;
  const set = game.tableSource?.key === `table:${table?.id}` && !game.tableSource.changed;
  return (
    <div className="event-line">
      <p>
        {table
          ? t(
              "Event round {round}, table {table}: {players} on {place}. The result goes in when the battle ends.",
              {
                round: open.round + 1,
                table: open.pairing.table,
                players: versus(open.pairing.players),
                place: table.name,
              },
            )
          : t("Event round {round}, table {table}: {players}. The result goes in when the battle ends.", {
              round: open.round + 1,
              table: open.pairing.table,
              players: versus(open.pairing.players),
            })}
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
            {t("Set up {table}", { table: here.name })}
          </button>
        ) : (
          <p className="muted small">
            {t("{table} isn't in this device's table library: whoever has it can set it up.", {
              table: table.name,
            })}
          </p>
        ))}
    </div>
  );
}
