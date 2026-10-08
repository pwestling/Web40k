import { useEffect, useMemo, useRef, useState } from "react";
import {
  clocks,
  clockText,
  sidePlayers,
  timeCall,
  timeCallOf,
  timeLeft,
  type ClockSettings,
  type Clocks,
} from "../core";
import { useStore } from "../store";
import { useGame } from "./hooks";

/** The clocks as the log has them, and "now" a second at a time while they run. */
function useClocks(): { c: Clocks; settings: ClockSettings; now: number } | null {
  const settings = useGame().settings.clock ?? null;
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const c = useMemo(() => (settings ? clocks(record) : null), [settings, record]);
  const ticking = !!c && c.running !== null && !c.paused && scrub === null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  if (!settings || !c) return null;
  // Not ticking (paused, over, or a replay): the clocks as they stood at the last event.
  return { c, settings, now: ticking ? Math.max(now, c.at) : c.at };
}

/** A side's chess clock in its top-bar chip: running, stopped or out of time; the host can give or take a minute while stopped. */
export function SideClock({ seat }: { seat: number }) {
  const clock = useClocks();
  const dispatch = useStore((s) => s.dispatch);
  const live = useStore((s) => s.scrub === null && s.role !== "spectator");
  const role = useStore((s) => s.net?.role);
  const mode = useStore((s) => s.mode);
  if (!clock) return null;
  const { c, settings, now } = clock;
  const left = timeLeft(c, settings, seat, now);
  const running = c.running === seat && !c.paused;
  const host = mode === "hotseat" || mode === "local" || role === "host";
  return (
    <span
      className={`side-clock${running ? " running" : ""}${left <= 0 ? " out" : ""}`}
      title={left <= 0 ? "Out of time" : running ? "This side's clock is running" : "Chess clock"}
      aria-label={`${clockText(left)} left${running ? ", running" : ""}${left <= 0 ? ", out of time" : ""}`}
    >
      ⏱ {clockText(left)}
      {live && host && c.paused && (
        <>
          <button
            title="Take a minute off"
            onClick={() => dispatch({ type: "clock/adjust", seat, ms: -60_000 })}
          >
            −1′
          </button>
          <button title="Give a minute" onClick={() => dispatch({ type: "clock/adjust", seat, ms: 60_000 })}>
            +1′
          </button>
        </>
      )}
    </span>
  );
}

/** Stop or restart the clocks, and the plain call when time is short ("Last turn: …"). */
export function ClockBar() {
  const clock = useClocks();
  const dispatch = useStore((s) => s.dispatch);
  const live = useStore((s) => s.scrub === null && s.role !== "spectator");
  const host = useStore((s) => s.mode === "hotseat" || s.mode === "local" || s.net?.role === "host");
  if (!clock) return null;
  const { c, settings, now } = clock;
  const call = timeCall(c, settings, now);
  const out = sidesOut(c, settings, now);
  if (c.battleStart === null && !call) return null;
  return (
    <div className="clock-bar" role="status">
      {c.paused === "disconnect" && <span className="warn">Clocks stopped: a player is disconnected.</span>}
      {c.paused === "hand" && <span className="muted">Clocks stopped.</span>}
      {call && <strong className="time-call">{call}</strong>}
      {out.map((name) => (
        <span key={name} className="warn">
          {name} is out of time.
        </span>
      ))}
      {live && !c.over && c.battleStart !== null && c.paused !== "disconnect" && (
        <button
          className="small"
          onClick={() => dispatch({ type: "clock/pause", paused: !c.paused, reason: "hand" })}
        >
          {c.paused ? "Restart the clocks" : "Stop the clocks"}
        </button>
      )}
      {live && host && !c.over && c.paused === "disconnect" && (
        <button
          className="small"
          title="Start the clocks again without waiting for them"
          onClick={() => dispatch({ type: "clock/pause", paused: false })}
        >
          Restart anyway
        </button>
      )}
      {live && host && c.paused && !c.over && (
        <span className="muted small">Use −1′ and +1′ on a side's clock to adjust it.</span>
      )}
      {live && host && !c.paused && !c.over && c.battleStart !== null && (
        <span
          className="muted small"
          title="The −1′ and +1′ buttons show on each side's clock while the clocks are stopped"
        >
          Stop the clocks to adjust them.
        </span>
      )}
    </div>
  );
}

function sidesOut(c: Clocks, settings: ClockSettings, now: number): string[] {
  const game = useStore.getState().game;
  const seats = [
    ...new Set(Object.values(game.players).flatMap((p) => (p.seat !== undefined ? [p.seat] : []))),
  ];
  return seats
    .filter((seat) => timeLeft(c, settings, seat, now) <= 0)
    .map((seat) =>
      sidePlayers(game, seat)
        .map((p) => p.name)
        .join(" & "),
    );
}

/**
 * On the host: stop the clocks while a seated player is disconnected, and
 * restart them when everyone is back (only if it was the host that stopped them).
 */
export function ClockKeeper() {
  const settings = useStore((s) => s.game.settings.clock);
  const record = useStore((s) => s.record);
  const net = useStore((s) => s.net);
  const players = useStore((s) => s.game.players);
  const selfId = useStore((s) => s.session?.selfId);
  const mode = useStore((s) => s.mode);
  const dispatch = useStore((s) => s.dispatch);
  const paused = useMemo(() => (settings ? clocks(record).paused : false), [settings, record]);
  // Who was away last time: the clocks stop when someone goes, not again after a "Restart anyway" (UX 216).
  const wasAway = useRef("");
  useEffect(() => {
    // Online only: hotseat and local players share this device, so nobody is ever away.
    if (!settings || mode !== "online" || net?.role !== "host") return;
    const away = Object.values(players)
      .filter((p) => p.seat !== undefined && p.id !== selfId && !net.peers.includes(p.id))
      .map((p) => p.id)
      .sort()
      .join(",");
    const before = wasAway.current;
    wasAway.current = away;
    // The host's own dispatch updates the log at once, so this runs once per change.
    if (away && away !== before && !paused)
      dispatch({ type: "clock/pause", paused: true, reason: "disconnect" });
    else if (!away && paused === "disconnect") dispatch({ type: "clock/pause", paused: false });
  }, [settings, mode, net, players, selfId, paused, dispatch]);
  return <ClockCaller />;
}

/**
 * On the host: write each time call into the log the first time it's made ("Last turn", a round over
 * its time, a side out of time), so a replay shows when it came (UX 218).
 */
function ClockCaller() {
  const clock = useClocks();
  const host = useStore((s) => s.mode === "hotseat" || s.mode === "local" || s.net?.role === "host");
  const live = useStore((s) => s.scrub === null && !s.review);
  const dispatch = useStore((s) => s.dispatch);
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!clock || !host || !live) return;
    const { c, settings, now } = clock;
    const game = useStore.getState().game;
    const due: { kind: string; text: string }[] = [];
    const call = timeCallOf(c, settings, now);
    if (call) due.push(call);
    if (!c.over && c.battleStart !== null)
      for (const seat of new Set(
        Object.values(game.players).flatMap((p) => (p.seat !== undefined ? [p.seat] : [])),
      ))
        if (timeLeft(c, settings, seat, now) <= 0)
          due.push({
            kind: `out-${seat}`,
            text: `${sidePlayers(game, seat)
              .map((p) => p.name)
              .join(" & ")} is out of time.`,
          });
    for (const d of due) {
      if (c.called.includes(d.kind) || sent.current.has(d.kind)) continue;
      sent.current.add(d.kind);
      dispatch({ type: "clock/call", kind: d.kind, text: d.text });
    }
  }, [clock, host, live, dispatch]);
  return null;
}

/** In Game settings: the clocks and time limits for this game. */
export function ClockSettingsRow({
  value,
  change,
}: {
  value: ClockSettings | null | undefined;
  change: (clock: ClockSettings | null) => void;
}) {
  // No undefined fields: they don't survive the trip to other players.
  const set = (patch: Partial<ClockSettings>) => {
    const next = { minutes: 90, ...value, ...patch };
    change(
      Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as unknown as ClockSettings,
    );
  };
  return (
    <div className="clock-settings">
      <label>
        Chess clock{" "}
        <select
          value={value?.minutes ?? 0}
          onChange={(e) => (Number(e.target.value) ? set({ minutes: Number(e.target.value) }) : change(null))}
        >
          <option value={0}>Off</option>
          {[45, 60, 75, 90, 105, 120, 150].map((m) => (
            <option key={m} value={m}>
              {m} minutes a side
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <label>
            Battle time limit{" "}
            <select
              value={value.gameMinutes ?? 0}
              onChange={(e) => set({ gameMinutes: Number(e.target.value) || undefined })}
            >
              <option value={0}>None</option>
              {[120, 150, 180, 210, 240].map((m) => (
                <option key={m} value={m}>
                  {m / 60} hours
                </option>
              ))}
            </select>
          </label>
          <label>
            Each battle round{" "}
            <select
              value={value.roundMinutes ?? 0}
              onChange={(e) => set({ roundMinutes: Number(e.target.value) || undefined })}
            >
              <option value={0}>Untimed</option>
              {[20, 30, 40, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Each side's clock runs while it has to act: its turn, its reactions and its saves. The clocks stop
            while a player is disconnected. Nothing is enforced; the time calls are for the players.
          </p>
        </>
      )}
    </div>
  );
}
