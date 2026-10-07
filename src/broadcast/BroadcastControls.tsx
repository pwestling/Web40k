import { useStore } from "../store";
import { currentCaster, useTalk } from "../talk/talk";
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
          onClick={() => useBroadcast.setState({ casting: !casting, follow: false })}
        >
          🎙 {casting ? "Commentating" : "Commentate"}
        </button>
        {!casting && live && (
          <button
            className={follow ? "on" : ""}
            title="Your camera follows the commentator's; move it yourself to stop"
            onClick={() => useBroadcast.setState({ follow: !follow })}
          >
            Follow {live.name.replace(/ \(watching\)$/, "")}
          </button>
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
