import { NET_PARAMS } from "../net/config";
import { useEffect, useMemo, useState } from "react";
import { momentsOf } from "../core/moments";
import { useStore } from "../store";
import { battleOver } from "../ui/StatsScreen";
import { castMoment } from "./Moments";
import { currentCaster, myName, setMyName, useTalk, withoutWatching } from "../talk/talk";
import { CASTER_FRESH_MS, DELAYS, useBroadcast, useNow } from "./broadcast";
import { t } from "../i18n";
import { displayName } from "../i18n/names";

const delayLabel = (s: number) =>
  s === 0 ? t("Live") : s < 60 ? t("{s} s behind", { s }) : t("{m} min behind", { m: s / 60 });

/**
 * For spectators: commentate (your camera goes out to the audience, your
 * drawings are table talk), follow the commentator, run behind the game,
 * and open the clean streaming view.
 */
export function BroadcastControls() {
  const { casting, follow, delay } = useBroadcast();
  const casters = useTalk((s) => s.casters);
  const roomId = useStore((s) => s.roomId);
  const mode = useStore((s) => s.mode);
  // Someone else's camera, if they are commentating (a stale one has stopped).
  const caster = currentCaster(casters);
  const now = useNow();
  const live = caster && now - caster.at < CASTER_FRESH_MS ? caster : null;
  // Once the game is over the commentator can bring up any moment for the audience.
  const over = useStore((s) => battleOver(s.game));
  const record = useStore((s) => s.record);
  // Commentators go on air under a name (UX 145): asked for once, if this screen has none.
  const [naming, setNaming] = useState<string | null>(null);
  const goOnAir = (name: string) => {
    setMyName(name.trim());
    setNaming(null);
    useBroadcast.setState({ casting: true, follow: false });
  };
  const moments = useMemo(() => (casting && over ? momentsOf(record) : []), [casting, over, record]);
  const streamLink = () => {
    const q = new URLSearchParams(location.search);
    q.set("view", "broadcast");
    if (roomId) q.set("room", roomId);
    if (mode === "local") q.set("local", "1");
    if (delay) q.set("delay", String(delay));
    else q.delete("delay");
    return `${location.pathname}?${q}`;
  };
  return (
    <div className="broadcast-controls">
      <div className="row wrap">
        <button
          className={casting ? "on" : ""}
          title={t(
            "Your camera goes out to everyone watching who follows it; draw with Ping, Arrow and Area",
          )}
          onClick={() => {
            if (!casting && !myName()) setNaming(naming === null ? "" : null);
            else useBroadcast.setState({ casting: !casting, follow: false });
          }}
        >
          🎙 {casting ? t("Commentating") : t("Commentate")}
        </button>
        {!casting && live && (
          <button
            className={follow ? "on" : ""}
            title={t("Your camera follows the commentator's; move it yourself to stop")}
            onClick={() => useBroadcast.setState({ follow: !follow })}
          >
            {/* Says so while on, apart from "Follow action" (UX 146). */}
            {follow
              ? t("🎥 Following {name}", { name: withoutWatching(live.name) })
              : t("Follow {name}", { name: withoutWatching(live.name) })}
          </button>
        )}
        {moments.length > 0 && (
          <select
            aria-label={t("Bring up a moment")}
            title={t("Show a moment's card to everyone following you, and replay it on the table")}
            value=""
            onChange={(e) => {
              const m = moments[Number(e.target.value)];
              if (m) castMoment(m);
            }}
          >
            <option value="">{t("Bring up a moment…")}</option>
            {moments.map((m, i) => (
              <option key={`${m.kind}-${m.seq}-${m.player ?? ""}`} value={i}>
                {m.kind === "rare" ? "★ " : ""}
                {m.title}
              </option>
            ))}
          </select>
        )}
        <label title={t("Watch the game this far behind, so a stream gives nothing away")}>
          <select
            aria-label={t("Delay")}
            value={delay}
            onChange={(e) => useBroadcast.setState({ delay: Number(e.target.value) })}
          >
            {DELAYS.map((d) => (
              <option key={d} value={d}>
                {delayLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <button
          title={t("A clean view of the board for streaming (OBS browser source), with this delay")}
          onClick={() => open(streamLink(), "_blank", "noopener")}
        >
          {t("Stream view ↗")}
        </button>
      </div>
      {naming !== null && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) goOnAir(naming);
          }}
        >
          <input
            autoFocus
            aria-label={t("Your name on air")}
            placeholder={t("Your name on air")}
            maxLength={24}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!naming.trim()}>
            {t("Go on air")}
          </button>
        </form>
      )}
    </div>
  );
}

/** The clean streaming view's corner badge: who is commentating, and the delay. */
export function BroadcastBadge() {
  const casters = useTalk((s) => s.casters);
  // What this screen asked for, or the host's own floor for a public game, whichever is longer.
  const delay = Math.max(
    useBroadcast((s) => s.delay),
    useStore((s) => Math.round((s.net?.hostDelay ?? 0) / 1000)),
  );
  const caster = currentCaster(casters);
  const now = useNow();
  const fresh = caster && now - caster.at < CASTER_FRESH_MS;
  useHostGone();
  const thinking = useThinking(now);
  const catchingUp = useStore((s) => s.game.turn.round === 0);
  if (!fresh && !delay && !FROM_TABLES) return null;
  return (
    <div className="broadcast-badge">
      {fresh && <span style={{ borderColor: caster.color }}>🎙 {withoutWatching(caster.name)}</span>}
      {delay > 0 && <span className="muted">{delayLabel(delay)}</span>}
      {/* A long pause reads as thinking, not as broken (PX). */}
      {/* A game from Live now that hasn't reached this screen's view yet (UX 445). */}
      {FROM_TABLES && catchingUp && delay > 0 && (
        <span className="muted catching-up">
          {t("Catching up: you'll see the table {s} s behind the players", { s: delay })}
        </span>
      )}
      {thinking && <span className="muted thinking">{t("{name} is thinking…", { name: thinking })}</span>}
      {/* Watching from Live now (#64): a way back to the board. */}
      {FROM_TABLES && (
        <button className="small" onClick={() => backToTables()}>
          {t("Leave")}
        </button>
      )}
      <WatcherInvite />
    </div>
  );
}

/** No event for this long on a watcher's table and the side with the go is "thinking". */
const QUIET_MS = 8000;

/** The name of the side taking its time, while nothing has happened for a while. */
function useThinking(now: number): string | null {
  const [last, setLast] = useState(() => ({ n: 0, at: now }));
  const n = useStore((s) => s.record.events.length);
  if (n !== last.n) setLast({ n, at: now });
  const game = useStore((s) => s.game);
  if (now - last.at < QUIET_MS || game.turn.round === 0 || battleOver(game)) return null;
  const active = Object.values(game.players).find((p) => p.seat === game.turn.activeSeat);
  return active ? displayName(active.name) : null;
}

/**
 * Watching from Live now, an invitation to play (PX): quiet after a minute,
 * the main thing at Battle over. "Find a game like this" for games between
 * people; the exhibition's own end card leads with "Play this yourself".
 */
export function WatcherInvite({ end = false }: { end?: boolean }) {
  const system = useStore((s) => s.game.system);
  const over = useStore((s) => battleOver(s.game));
  const [due, setDue] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDue(true), 60_000);
    return () => clearTimeout(timer);
  }, []);
  if (!FROM_TABLES || !(due || over || end)) return null;
  const go = (q: Record<string, string>) => {
    const next = new URLSearchParams(q);
    const here = new URLSearchParams(location.search);
    for (const k of NET_PARAMS) if (here.get(k)) next.set(k, here.get(k)!);
    window.location.assign(`${location.pathname}?${next}`);
  };
  return (
    <div className={end ? "watcher-invite end" : "watcher-invite"}>
      <button className={end ? "primary" : "small"} onClick={() => go({ play: system ?? "" })}>
        {t("Play this yourself")}
      </button>
      {!COMPUTER && (
        <button className="small" onClick={() => go({ tables: "1" })}>
          {t("Find a game like this")}
        </button>
      )}
    </div>
  );
}

/** Watching the computer play itself (Live now's exhibition card). */
const COMPUTER = typeof location !== "undefined" && new URLSearchParams(location.search).get("cpu") === "1";

/** This view was opened from Open tables' Live now. */
const FROM_TABLES =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("from") === "tables";

/** No host for this long and a watcher from Live now goes back to the board (UX 441), as guests do. */
const GONE_MS = 15_000;

/** Watching from Live now with no host there: the game ended or its host left. */
function useHostGone(): void {
  useEffect(() => {
    if (!FROM_TABLES) return;
    let seen = Date.now();
    const timer = setInterval(() => {
      const net = useStore.getState().net;
      // At Battle over a host leaving is the table packing up, not a lost game (PX).
      const over = battleOver(useStore.getState().game);
      if (over || (net?.hostId && net.peers.includes(net.hostId) && !net.migrating)) seen = Date.now();
      else if (Date.now() - seen > GONE_MS) {
        clearInterval(timer);
        backToTables(useStore.getState().roomId);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
}

/** Back to Open tables; `ended`: the room of a game whose host has gone, for the board to say so. */
function backToTables(ended?: string | null): void {
  const q = new URLSearchParams(ended ? { tables: "ended", ended } : { tables: "1" });
  const here = new URLSearchParams(location.search);
  for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
  window.location.assign(`${location.pathname}?${q}`);
}
