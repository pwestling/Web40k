import { useEffect, useRef } from "react";
import { rankedOver, rankedSeats } from "../core/ranked";
import { t } from "../i18n";
import { displayName } from "../i18n/names";
import { language } from "../i18n";
import { liveInfo } from "../opentables/live";
import { postTable, useOpenTables } from "../opentables/board";
import { useShelf } from "../packages/shelf";
import { myKey, useCard } from "../player/card";
import { playRanked } from "../ranked/RankedGame";
import { useStore } from "../store";
import { useDeployed } from "../ui/shelfActions";
import { armyHash } from "./event";
import { deployShelfArmy } from "../ui/shelfActions";
import { backToEvent, registeredArmy } from "./play";
import { useEventDocs } from "./store";

/** Top tables an event shows on Live now (#67). */
const LIVE_TABLES = 2;

/**
 * An event's game at the table (#67): which event, round and table; each
 * player's army checked against the one they registered; one click to put
 * yours down; ranked from the start, as entering agreed; and back to the
 * event when it's over. Its top tables go on Live now.
 */
export function EventSeat() {
  const at = useStore((s) => s.game.settings.event);
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const role = useStore((s) => s.net?.role);
  const { events } = useEventDocs(false);
  const doc = at ? events[at.id]?.doc : undefined;
  const key = useCard((c) => c.key);
  const deployed = useDeployed((d) => (self ? d[self] : undefined));
  const armies = useShelf((s) => s.armies);
  useEffect(() => {
    void myKey();
    void useShelf.getState().load();
  }, []);
  const seated = !!self && typeof game.players[self]?.seat === "number";
  const entrant = doc?.entrants.find((e) => e.key === key);
  const over = rankedOver(game);

  // Ranked from the start: entering the event said yes to it.
  const asked = useRef(false);
  useEffect(() => {
    if (!at || !seated || !entrant || over || asked.current || game.ranked?.keys[self!]) return;
    asked.current = true;
    void playRanked();
  }, [at, seated, entrant, over, game.ranked, self]);

  // The army this player put down, by its hash, for both players to check against the registration.
  const hash = deployed ? armyHash(deployed.roster) : null;
  useEffect(() => {
    if (!at || !seated || !hash || game.eventArmies?.[self!] === hash) return;
    useStore.getState().dispatch({ type: "event/army", hash });
  }, [at, seated, hash, game.eventArmies, self]);

  // The top tables on Live now, once the battle is on (never as a table looking for players).
  const posted = useRef(false);
  const mine = useOpenTables((s) => s.mine);
  useEffect(() => {
    if (!at || !doc?.live || at.table > LIVE_TABLES || role !== "host" || game.turn.round < 1 || over) return;
    if (posted.current || mine?.post.join === useStore.getState().roomId) return;
    posted.current = true;
    const s = useStore.getState();
    void postTable({
      id: [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join(""),
      name: (entrant?.name ?? s.game.players[self!]?.name ?? "").slice(0, 32) || "Player",
      system: doc.system,
      game: doc.game,
      size: doc.points ? `${doc.points} pts` : "",
      start: null,
      lang: language(),
      kind: "live",
      voice: false,
      seats: 0,
      note: "",
      join: s.roomId ?? "",
      watch: true,
      live: { ...liveInfo(s.game, 0), since: Date.now() },
      event: { id: at.id, name: at.name.slice(0, 60), round: at.round, table: at.table },
      expires: Date.now() + 4 * 3600_000,
    });
  }, [at, doc, role, game.turn.round, over, mine, entrant, self]);

  if (!at) return null;
  const shelfArmy = doc && key ? registeredArmy(doc, key) : null;
  void armies;
  const mineDown = !!self && Object.values(game.units).some((u) => u.owner === self);
  // Each seated player's army against what they registered.
  const checks = rankedSeats(game).flatMap((pid) => {
    const k = game.ranked?.keys[pid];
    const e = doc?.entrants.find((x) => x.key === k);
    if (!e) return [];
    const got = game.eventArmies?.[pid];
    const name = displayName(game.players[pid]?.name ?? e.name);
    return [
      {
        pid,
        tone: !got ? "muted" : got === e.army ? "good" : "warn",
        text: !got
          ? t("{name}: army not down yet", { name })
          : got === e.army
            ? t("{name}: the army registered ✓", { name })
            : t("{name}'s army isn't the one registered ({army})", { name, army: e.armyName }),
      },
    ];
  });
  return (
    <div className="event-seat" role="status">
      <strong>{at.name}</strong>{" "}
      <span className="small">
        {doc
          ? t("Event round {n} of {of} · Table {table}", { n: at.round, of: doc.rounds, table: at.table })
          : t("Event round {n} · Table {table}", { n: at.round, table: at.table })}
      </span>
      {checks.length > 0 && (
        <ul className="plain small">
          {checks.map((c) => (
            <li key={c.pid} className={c.tone}>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {seated && !mineDown && game.turn.round === 0 && entrant && (
        <p className="small">
          {shelfArmy ? (
            <button className="primary small" onClick={() => deployShelfArmy(shelfArmy, self!)}>
              {t("Deploy {army}", { army: shelfArmy.name })}
            </button>
          ) : (
            t("Your registered army ({army}) isn't on this device's shelf.", { army: entrant.armyName })
          )}
        </p>
      )}
      {over && (
        <button className="small" onClick={() => backToEvent(at.id)}>
          {t("Back to the event")}
        </button>
      )}
    </div>
  );
}
