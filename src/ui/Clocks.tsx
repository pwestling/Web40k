import { useEffect, useMemo, useState } from "react";
import { clocks, clockText, sidePlayers, timeCall, timeLeft, type ClockSettings, type Clocks } from "../core";
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
  useEffect(() => {
    // Online only: hotseat and local players share this device, so nobody is ever away.
    if (!settings || mode !== "online" || net?.role !== "host") return;
    const away = Object.values(players).some(
      (p) => p.seat !== undefined && p.id !== selfId && !net.peers.includes(p.id),
    );
    // The host's own dispatch updates the log at once, so this runs once per change.
    if (away && !paused) dispatch({ type: "clock/pause", paused: true, reason: "disconnect" });
    else if (!away && paused === "disconnect") dispatch({ type: "clock/pause", paused: false });
  }, [settings, mode, net, players, selfId, paused, dispatch]);
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
