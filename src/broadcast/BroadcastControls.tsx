import { useMemo, useState } from "react";
import { momentsOf } from "../core/moments";
import { useStore } from "../store";
import { battleOver } from "../ui/StatsScreen";
import { castMoment } from "./Moments";
import { currentCaster, myName, setMyName, useTalk } from "../talk/talk";
import { CASTER_FRESH_MS, DELAYS, useBroadcast, useNow } from "./broadcast";

const delayLabel = (s: number) => (s === 0 ? "Live" : s < 60 ? `${s} s behind` : `${s / 60} min behind`);

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
          title="Your camera goes out to everyone watching who follows it; draw with Ping, Arrow and Area"
          onClick={() => {
            if (!casting && !myName()) setNaming(naming === null ? "" : null);
            else useBroadcast.setState({ casting: !casting, follow: false });
          }}
        >
          🎙 {casting ? "Commentating" : "Commentate"}
        </button>
        {!casting && live && (
          <button
            className={follow ? "on" : ""}
            title="Your camera follows the commentator's; move it yourself to stop"
            onClick={() => useBroadcast.setState({ follow: !follow })}
          >
            {/* Says so while on, apart from "Follow action" (UX 146). */}
            {follow ? "🎥 Following" : "Follow"} {live.name.replace(/ \(watching\)$/, "")}
          </button>
        )}
        {moments.length > 0 && (
          <select
            aria-label="Bring up a moment"
            title="Show a moment's card to everyone following you, and replay it on the table"
            value=""
            onChange={(e) => {
              const m = moments[Number(e.target.value)];
              if (m) castMoment(m);
            }}
          >
            <option value="">Bring up a moment…</option>
            {moments.map((m, i) => (
              <option key={`${m.kind}-${m.seq}-${m.player ?? ""}`} value={i}>
                {m.kind === "rare" ? "★ " : ""}
                {m.title}
              </option>
            ))}
          </select>
        )}
        <label title="Watch the game this far behind, so a stream gives nothing away">
          <select
            aria-label="Delay"
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
          title="A clean view of the board for streaming (OBS browser source), with this delay"
          onClick={() => open(streamLink(), "_blank", "noopener")}
        >
          Stream view ↗
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
            aria-label="Your name on air"
            placeholder="Your name on air"
            maxLength={24}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!naming.trim()}>
            Go on air
          </button>
        </form>
      )}
    </div>
  );
}

/** The clean streaming view's corner badge: who is commentating, and the delay. */
export function BroadcastBadge() {
  const casters = useTalk((s) => s.casters);
  const delay = useBroadcast((s) => s.delay);
  const caster = currentCaster(casters);
  const now = useNow();
  const fresh = caster && now - caster.at < CASTER_FRESH_MS;
  if (!fresh && !delay) return null;
  return (
    <div className="broadcast-badge">
      {fresh && (
        <span style={{ borderColor: caster.color }}>🎙 {caster.name.replace(/ \(watching\)$/, "")}</span>
      )}
      {delay > 0 && <span className="muted">{delayLabel(delay)}</span>}
    </div>
  );
}
