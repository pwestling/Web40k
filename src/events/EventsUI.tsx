import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import { listSystems } from "../core/content";
import { useLibrary } from "../packages/library";
import { shelfSystem, useShelf } from "../packages/shelf";
import { myKey, useCard } from "../player/card";
import { useResultsOften } from "../ranked/store";
import { systemModule } from "../systems";
import { RIFT_LANTERNS } from "../games/riftLanterns";
import { plainSystemName, systemLabel, systemTitle } from "../ui/systemLabels";
import {
  armyHash,
  eventStandings,
  myPairing,
  rankLabels,
  resultOf,
  type EntryDoc,
  type EventDoc,
} from "./event";
import { closeEvent, openEvent, runAnEvent, useEventOpen } from "./open";
import { playPairing } from "./play";
import {
  enter,
  pairNext,
  postEvent,
  setDropped,
  setHandResult,
  startEvent,
  useEventDocs,
  useEventResults,
  useRunMyEvents,
} from "./store";

/**
 * Online events (#67) on screen: the list on Open tables, the form to run
 * one, and an event's page (who's in, each round's pairings with one click
 * to your game, the standings, and the organiser's tools).
 */

/** The event's page, or the form to run one: a modal over whatever is showing. */
export function EventDialog() {
  const { id, running } = useEventOpen();
  useEffect(() => {
    if (!id && !running) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeEvent();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [id, running]);
  if (!id && !running) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={closeEvent}>
      <div
        className="panel modal event-page"
        role="dialog"
        aria-label={running ? t("Run an event") : t("Event")}
        onClick={(e) => e.stopPropagation()}
      >
        {running ? <RunEvent /> : <EventPage id={id!} />}
      </div>
    </div>,
    document.body,
  );
}

function Close() {
  return (
    <button className="quiet" title={t("Close")} aria-label={t("Close")} onClick={closeEvent}>
      ✕
    </button>
  );
}

/** "Saturday 14:00", or "now" once it has started. */
const when = (at: number) =>
  formatDate(at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function stateLine(e: EventDoc): string {
  if (e.done) return t("Finished");
  if (!e.closed) return t("Taking entries · starts {when}", { when: when(e.start) });
  return t("Event round {n} of {of}", { n: e.pairings.length, of: e.rounds });
}

/** How long before an organiser's device counts as gone (it says it's there every few minutes; UX 458). */
const AWAY_MS = 12 * 60_000;
/** Mid-event, with the organiser's device not heard from: pairing has stopped. */
const organiserAway = (e: EventDoc, now: number) => e.closed && !e.done && now - e.at > AWAY_MS;

/** The organiser by the name they entered with, if they play; else "the organiser". */
const organiserName = (e: EventDoc) =>
  e.entrants.find((x) => x.key === e.organiser)?.name ?? t("the organiser");

/** The time now (kept out of render's view: the lists are worked out when the docs change). */
const clockNow = () => Date.now();

/** The events on the board, for Open tables: running and coming up, and those just finished. */
export function EventsSection() {
  const { events, entries, loaded } = useEventDocs();
  const list = useMemo(
    () =>
      Object.values(events)
        .map((e) => e.doc)
        // Finished or abandoned (the organiser's device gone) a day ago: off the board.
        .filter((e) => e.at > clockNow() - 24 * 3600_000 || (!e.done && !e.closed))
        .sort((a, b) => Number(a.done) - Number(b.done) || a.start - b.start),
    [events],
  );
  return (
    <section className="events-section">
      <div className="row spread">
        <h3>{t("Events")}</h3>
        <button onClick={runAnEvent}>{t("Run an event")}</button>
      </div>
      {list.length ? (
        <ul className="plain">
          {list.map((e) => {
            const count = e.closed
              ? e.entrants.length
              : Object.values(entries[e.id] ?? {}).filter((x) => !x.doc.out).length;
            return (
              <li key={e.id} className={organiserAway(e, clockNow()) ? "event-card away" : "event-card"}>
                <div>
                  <strong>{e.name}</strong>{" "}
                  <span className="muted small">
                    {[
                      e.game,
                      e.points ? t("{n} pts", { n: e.points }) : null,
                      tn(e.rounds, "{n} round", "{n} rounds"),
                      tn(count, "{n} player", "{n} players"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="small">
                    {organiserAway(e, clockNow()) ? (
                      <span className="warn">
                        {t("Paused: {name} is away", { name: displayName(organiserName(e)) })}
                      </span>
                    ) : (
                      stateLine(e)
                    )}
                  </div>
                </div>
                <button className="primary small" onClick={() => openEvent(e.id)}>
                  {t("Open")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">
          {loaded
            ? t("No events right now. Run one: a club night or a tournament, Swiss rounds, no server needed.")
            : t("Looking for events…")}
        </p>
      )}
    </section>
  );
}

/** The games an event can be for: the built-in ones and whole games from trusted packages. */
function useGames(): { id: string; name: string }[] {
  const library = useLibrary((s) => s.packages);
  useEffect(() => void useLibrary.getState().load(), []);
  return useMemo(() => {
    const built = listSystems().map((s) => ({ id: s.id, name: plainSystemName(systemLabel(s.id, s.name)) }));
    const pkgs = Object.values(library)
      .filter((p) => p.trusted && p.manifest.kind === "system" && p.manifest.systems[0])
      .filter((p) => !built.some((b) => b.id === p.manifest.systems[0]))
      .map((p) => ({ id: p.manifest.systems[0]!, name: plainSystemName(p.manifest.name) }));
    return [...built, ...pkgs];
  }, [library]);
}

const localInput = (at: number) => {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function RunEvent() {
  const games = useGames();
  const cardName = useCard((c) => c.name.trim());
  const [name, setName] = useState(() =>
    cardName ? t("{name}'s event", { name: cardName }) : t("Club night"),
  );
  const [system, setSystem] = useState(() => localStorage.getItem("open-battle:system") ?? RIFT_LANTERNS);
  const [points, setPoints] = useState("");
  const [rounds, setRounds] = useState(3);
  const [start, setStart] = useState(() =>
    localInput(Math.ceil((Date.now() + 30 * 60_000) / 900_000) * 900_000),
  );
  const [clock, setClock] = useState("60");
  const [live, setLive] = useState(true);
  const [missions, setMissions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const game = games.find((g) => g.id === system) ?? games[0];
  // A built-in game's missions to pick from; a package game's aren't known until it runs: players choose.
  const known = systemModule(system).missions ?? [];
  const submit = async () => {
    if (!game || !name.trim()) return;
    setBusy(true);
    const id = await postEvent({
      name: name.trim().slice(0, 60),
      system: game.id,
      game: game.name.slice(0, 64),
      points: Number(points) > 0 ? Math.round(Number(points)) : null,
      rounds,
      start: new Date(start).getTime() || clockNow(),
      missions: Array.from({ length: rounds }, (_, i) => {
        const m = known.find((x) => x.id === missions[i]);
        return m ? { id: m.id, name: m.name } : null;
      }),
      clock: Number(clock) > 0 ? Math.round(Number(clock)) : null,
      live,
    });
    setBusy(false);
    openEvent(id);
  };
  return (
    <form
      className="run-event"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="row spread">
        <h2>{t("Run an event")}</h2>
        <Close />
      </div>
      <p className="muted small">
        {t(
          "Swiss rounds with no server: your browser publishes the event and pairs each round once the last is in, so keep this device on during the event. Players enter with their player card and a shelf army.",
        )}
      </p>
      <label>
        {t("Name")} <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t("Game")}{" "}
        <select value={game?.id ?? ""} onChange={(e) => setSystem(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row wrap">
        <label>
          {t("Points")}{" "}
          <input
            type="number"
            min={0}
            step={50}
            value={points}
            placeholder={t("any")}
            onChange={(e) => setPoints(e.target.value)}
          />
        </label>
        <label>
          {t("Rounds")}{" "}
          <input
            type="number"
            min={1}
            max={8}
            value={rounds}
            onChange={(e) => setRounds(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          {t("Minutes on each clock")}{" "}
          <input type="number" min={0} step={15} value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
      </div>
      <label>
        {t("Starts")} <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      {Array.from({ length: rounds }, (_, i) => (
        <label key={i}>
          {t("Round {n} mission", { n: i + 1 })}{" "}
          <select
            value={missions[i] ?? ""}
            onChange={(e) => setMissions((m) => Object.assign([...m], { [i]: e.target.value }))}
          >
            <option value="">{t("Players choose")}</option>
            {known.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />{" "}
        {t("Show the top tables on Live now")}
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !name.trim() || !game}>
          {t("Post the event")}
        </button>
      </div>
    </form>
  );
}

function EventPage({ id }: { id: string }) {
  const { events, entries } = useEventDocs(true);
  const doc = events[id]?.doc;
  const key = useCard((c) => c.key);
  useEffect(() => void myKey(), []);
  useResultsOften(!!doc && doc.closed && !doc.done);
  const results = useEventResults();
  if (!doc)
    return (
      <>
        <div className="row spread">
          <h2>{t("Event")}</h2>
          <Close />
        </div>
        <p className="muted">{t("Looking for this event on the board…")}</p>
      </>
    );
  const organiser = doc.organiser === key;
  const standings = eventStandings(doc, results);
  const ranks = rankLabels(standings);
  const round = doc.pairings.length;
  return (
    <>
      <div className="row spread">
        <h2>{doc.name}</h2>
        <Close />
      </div>
      <p className="muted small">
        {[
          systemTitle(doc.system) === doc.system ? doc.game : systemTitle(doc.system),
          doc.points ? t("{n} pts", { n: doc.points }) : null,
          tn(doc.rounds, "{n} round", "{n} rounds"),
          doc.clock ? tn(doc.clock, "{n}-minute clocks", "{n}-minute clocks") : null,
          when(doc.start),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="event-state">
        {doc.done && standings[0] ? (
          <strong>
            {t("Finished: {name} wins {event}, {w}–{d}–{l}", {
              name: displayName(standings[0].name),
              event: doc.name,
              w: standings[0].won,
              d: standings[0].drawn,
              l: standings[0].lost,
            })}
          </strong>
        ) : (
          <strong>{stateLine(doc)}</strong>
        )}
        {organiser && !doc.done && (
          <span className="muted small"> · {t("You run this event: keep this device on.")}</span>
        )}
      </p>
      {!organiser && <OrganiserSeen doc={doc} />}
      {!doc.closed && (
        <Entries doc={doc} entries={Object.values(entries[id] ?? {}).map((e) => e.doc)} me={key} />
      )}
      {round > 0 && (
        <Round doc={doc} round={round} me={key} organiser={organiser} results={results} key={round} />
      )}
      {doc.pairings.length > 1 && (
        <details className="past-rounds">
          <summary>{t("Earlier rounds")}</summary>
          {doc.pairings.slice(0, -1).map((_, i) => (
            <Round key={i} doc={doc} round={i + 1} me={key} organiser={organiser} results={results} past />
          ))}
        </details>
      )}
      {doc.closed && (
        <>
          <h3>{doc.done ? t("Final standings") : t("Standings")}</h3>
          <table className="standings">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("Player")}</th>
                <th title={t("3 a win or a bye, 1 a draw")}>{t("Points")}</th>
                <th>{t("W–D–L")}</th>
                <th>{t("VP")}</th>
                <th title={t("Strength of schedule: your opponents' points")}>{t("SoS")}</th>
                {organiser && <th />}
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr
                  key={s.key}
                  className={
                    [s.key === key ? "me" : "", s.dropped ? "dropped" : ""].join(" ").trim() || undefined
                  }
                >
                  <td>{ranks[i]}</td>
                  <td>
                    {displayName(s.name)}
                    {s.dropped ? <span className="muted small"> {t("(dropped)")}</span> : null}
                  </td>
                  <td>{s.points}</td>
                  <td>{t("{w}–{d}–{l}", { w: s.won, d: s.drawn, l: s.lost })}</td>
                  <td>{t("{for}–{against}", { for: s.vpFor, against: s.vpAgainst })}</td>
                  <td>{s.sos}</td>
                  {organiser && (
                    <td>
                      {!doc.done && (
                        <button
                          className="quiet small"
                          onClick={() => void setDropped(doc.id, s.key, !s.dropped)}
                        >
                          {s.dropped ? t("Back in") : t("Drop")}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {t(
              "SoS: strength of schedule, your opponents' points. Ties go to SoS, then VP difference, then VP.",
            )}
          </p>
          {organiser && !doc.done && <PairNow doc={doc} round={round} results={results} />}
        </>
      )}
    </>
  );
}

/** The organiser moves on before every result is in: asked first, with the tables still playing named (UX 456). */
function PairNow({
  doc,
  round,
  results,
}: {
  doc: EventDoc;
  round: number;
  results: ReturnType<typeof useEventResults>;
}) {
  const [asking, setAsking] = useState(false);
  const names = new Map(doc.entrants.map((e) => [e.key, displayName(e.name)]));
  const open = (doc.pairings[round - 1] ?? []).filter(
    (p) => p.players.length === 2 && !resultOf(doc, round, p, results),
  );
  const last = round >= doc.rounds;
  const go = () => {
    setAsking(false);
    void pairNext(doc.id, results);
  };
  return asking && open.length ? (
    <div className="confirm small" role="alertdialog">
      <p>
        {tn(
          open.length,
          "{tables} has no result yet. It counts as not played: no points for either player.",
          "{tables} have no result yet. They count as not played: no points for either player.",
          {
            tables: open
              .map((p) =>
                t("Table {n} ({a} vs {b})", {
                  n: p.table,
                  a: names.get(p.players[0]!) ?? "?",
                  b: names.get(p.players[1]!) ?? "?",
                }),
              )
              .join(", "),
          },
        )}
      </p>
      <p className="row wrap">
        <button className="small" onClick={go}>
          {last ? t("Finish anyway") : t("Pair anyway")}
        </button>
        <button className="small primary" onClick={() => setAsking(false)}>
          {t("Wait for them")}
        </button>
        <span className="muted">{t("Or enter their results by hand above.")}</span>
      </p>
    </div>
  ) : (
    <p className="row wrap small">
      <button className="small" onClick={() => (open.length ? setAsking(true) : go())}>
        {last ? t("Finish the event now") : t("Pair round {n} now", { n: round + 1 })}
      </button>
      <span className="muted">{t("Each round pairs itself once every result is in.")}</span>
    </p>
  );
}

/** When the organiser's device was last heard from; mid-event, after a while, that pairing has stopped (UX 458). */
function OrganiserSeen({ doc }: { doc: EventDoc }) {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (doc.done) return null;
  const minutes = Math.floor((now - doc.at) / 60_000);
  if (minutes < 7) return null;
  return organiserAway(doc, now) ? (
    <p className="warn small" role="status">
      {t(
        "The organiser's device was last seen {n} minutes ago, so the next round won't be paired until it's back. Games already played still count.",
        { n: minutes },
      )}
    </p>
  ) : (
    <p className="muted small">
      {t("The organiser's device was last seen {n} minutes ago.", { n: minutes })}
    </p>
  );
}

function Entries({ doc, entries, me }: { doc: EventDoc; entries: EntryDoc[]; me: string | null }) {
  const armies = useShelf((s) => s.armies);
  const shelfLoaded = useShelf((s) => s.loaded);
  useEffect(() => void useShelf.getState().load(), []);
  const mine = useMemo(
    () =>
      Object.values(armies)
        .filter((a) => a.system === shelfSystem(doc.system))
        .sort((a, b) => b.savedAt - a.savedAt),
    [armies, doc.system],
  );
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const accepted = new Set(doc.entrants.map((e) => e.key));
  const shown = [
    ...doc.entrants.map((e) => ({ key: e.key, name: e.name, army: e.armyName, waiting: false })),
    ...entries
      .filter((e) => !e.out && !accepted.has(e.key))
      .map((e) => ({ key: e.key, name: e.name, army: e.armyName, waiting: true })),
  ];
  const myEntry = entries.find((e) => e.key === me && !e.out);
  const meIn = !!me && (accepted.has(me) || !!myEntry);
  const organiser = doc.organiser === me;
  const army = mine.find((a) => a.id === (pick || mine[0]?.id));
  const join = async () => {
    if (!army) return;
    setBusy(true);
    await enter(doc.id, { hash: armyHash(army.roster), name: army.name });
    setBusy(false);
  };
  const withdraw = async () => {
    const was = myEntry ?? doc.entrants.find((e) => e.key === me);
    if (!was) return;
    setBusy(true);
    await enter(doc.id, { hash: was.army, name: was.armyName }, true);
    setBusy(false);
  };
  return (
    <section className="event-entries">
      <h3>{tn(shown.length, "{n} player in", "{n} players in")}</h3>
      {shown.length > 0 && (
        <ul className="plain small">
          {shown.map((e) => (
            <li key={e.key} className={e.key === me ? "me" : undefined}>
              {displayName(e.name)} <span className="muted">· {e.army}</span>
              {e.waiting && (
                <span className="muted">
                  {" "}
                  · {t("waiting for {name} to confirm it", { name: displayName(organiserName(doc)) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {meIn ? (
        <p className="row wrap small">
          {organiser || accepted.has(me!)
            ? t("You're in.")
            : t(
                "You're in once {name} confirms it (their device does, when it's on). Your army locks then.",
                {
                  name: displayName(organiserName(doc)),
                },
              )}{" "}
          <button className="quiet small" disabled={busy} onClick={() => void withdraw()}>
            {t("Withdraw")}
          </button>
        </p>
      ) : !shelfLoaded ? (
        <p className="muted small">{t("Checking your shelf…")}</p>
      ) : mine.length ? (
        <div className="row wrap">
          <label>
            {t("Your army")}{" "}
            <select value={army?.id ?? ""} onChange={(e) => setPick(e.target.value)}>
              {mine.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy || !army} onClick={() => void join()}>
            {t("Enter")}
          </button>
        </div>
      ) : (
        <p className="muted small">
          {t(
            "To enter, put the army you'll bring on your shelf first: deploy it in any game of {game} and press Save army to your shelf.",
            { game: doc.game },
          )}
        </p>
      )}
      {organiser && (
        <p className="row wrap small">
          <button className="primary" disabled={shown.length < 2} onClick={() => void startEvent(doc.id)}>
            {t("Start now")}
          </button>
          <span className="muted">{t("Or it starts at its time with whoever has entered.")}</span>
        </p>
      )}
    </section>
  );
}

function Round({
  doc,
  round,
  me,
  organiser,
  results,
  past = false,
}: {
  doc: EventDoc;
  round: number;
  me: string | null;
  organiser: boolean;
  results: ReturnType<typeof useEventResults>;
  past?: boolean;
}) {
  const names = new Map(doc.entrants.map((e) => [e.key, displayName(e.name)]));
  const pairs = doc.pairings[round - 1] ?? [];
  const mineNow = !past && !doc.done ? myPairing(doc, round, me) : null;
  const mineResult = mineNow ? resultOf(doc, round, mineNow, results) : null;
  const mission = doc.missions[round - 1];
  return (
    <section className={past ? "event-round past" : "event-round"}>
      <h3>
        {t("Round {n}", { n: round })}
        {mission ? <span className="muted small"> · {mission.name}</span> : null}
      </h3>
      {mineNow && mineNow.players.length === 2 && !mineResult && (
        <p className="row wrap">
          <button className="primary" onClick={() => void playPairing(doc, round, mineNow)}>
            {t("Play your game: table {n}", { n: mineNow.table })}
          </button>
          <span className="small">
            {t("against {name}", { name: names.get(mineNow.players.find((k) => k !== me)!) ?? "?" })}
          </span>
        </p>
      )}
      <ul className="plain pairings">
        {pairs.map((p) => {
          const r = resultOf(doc, round, p, results);
          return (
            <li key={p.table} className={p.players.includes(me ?? "") ? "me" : undefined}>
              <span className="table-no">{t("Table {n}", { n: p.table })}</span>{" "}
              {p.players.length === 1 ? (
                t("{name} has a bye", { name: names.get(p.players[0]!) ?? "?" })
              ) : (
                <>
                  {names.get(p.players[0]!)} {r ? <strong>{`${r.vp[0]}–${r.vp[1]}`}</strong> : t("vs")}{" "}
                  {names.get(p.players[1]!)}{" "}
                  <span className="muted small">
                    {r ? (r.byHand ? t("entered by the organiser") : t("signed")) : t("playing")}
                  </span>
                </>
              )}
              {organiser && p.players.length === 2 && !doc.done && (
                <HandEntry doc={doc} round={round} table={p.table} has={!!r} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The organiser's result for a pairing: for a game played off the app, or a ruling on a dispute. */
function HandEntry({
  doc,
  round,
  table,
  has,
}: {
  doc: EventDoc;
  round: number;
  table: number;
  has: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [note, setNote] = useState("");
  const hand = doc.hand.find((h) => h.round === round && h.table === table);
  if (!open)
    return (
      <span className="hand-entry">
        <button className="quiet small" onClick={() => setOpen(true)}>
          {has ? t("Rule on it") : t("Enter result")}
        </button>
        {hand && (
          <button className="quiet small" onClick={() => void setHandResult(doc.id, round, table, null)}>
            {t("Clear ruling")}
          </button>
        )}
      </span>
    );
  return (
    <form
      className="row wrap hand-entry"
      onSubmit={(e) => {
        e.preventDefault();
        const vp: [number, number] = [
          Math.max(0, Math.round(Number(a) || 0)),
          Math.max(0, Math.round(Number(b) || 0)),
        ];
        void setHandResult(doc.id, round, table, vp, note);
        setOpen(false);
      }}
    >
      <input
        type="number"
        min={0}
        aria-label={t("First player's VP")}
        value={a}
        onChange={(e) => setA(e.target.value)}
      />
      –
      <input
        type="number"
        min={0}
        aria-label={t("Second player's VP")}
        value={b}
        onChange={(e) => setB(e.target.value)}
      />
      <input
        placeholder={t("Note (why)")}
        maxLength={140}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="small primary">{t("Save")}</button>
      <button type="button" className="quiet small" onClick={() => setOpen(false)}>
        {t("Cancel")}
      </button>
    </form>
  );
}

/** Runs this device's events in the background while the app is open (mounted only when it organises one). */
export function EventRunner() {
  useEventDocs(true);
  useResultsOften(true);
  useRunMyEvents();
  return null;
}
