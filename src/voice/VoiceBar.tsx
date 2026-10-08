import { useState } from "react";
import { useStore } from "../store";
import { who } from "../talk/talk";
import { micOff, micOn, pushToTalk, setMode, setMuted, setVolume, useVoice, useVoiceRoom } from "./voice";

/** Voice for the room, always on while in a game (the bar can come and go). */
export function VoiceRoom() {
  useVoiceRoom();
  return null;
}

/**
 * The voice controls over the table talk: turn the mic on, hold to talk (or
 * leave it open), and everyone else in voice with a mute and a volume each.
 * Spectators listen until they choose to speak.
 */
export function VoiceBar() {
  const media = useStore((s) => !!s.session?.media);
  const spectator = useStore((s) => s.role === "spectator");
  const me = useStore((s) => s.session?.selfId ?? "");
  useStore((s) => s.game.players);
  const { mic, mode, live, error, peers, speaking, muted, volume } = useVoice();
  const [people, setPeople] = useState(false);
  if (!media) return null;
  const others = Object.entries(peers).filter(([id]) => id !== me);

  return (
    <div className="panel voice">
      <div className="row">
        {!mic ? (
          <button title="Talk to the table with your microphone" onClick={() => void micOn()}>
            🎙 {spectator ? "Speak too" : "Voice"}
          </button>
        ) : mode === "ptt" ? (
          <button
            className={`ptt${live ? " live" : ""}${speaking[me] ? " speaking" : ""}`}
            title="Hold to talk (or hold V)"
            onPointerDown={() => pushToTalk(true)}
            onPointerUp={() => pushToTalk(false)}
            onPointerLeave={() => pushToTalk(false)}
          >
            {live ? "Talking…" : "Hold to talk (V)"}
          </button>
        ) : (
          <span className={`open-mic${speaking[me] ? " speaking" : ""}`}>🎙 Mic open</span>
        )}
        {mic && (
          <>
            <select
              value={mode}
              aria-label="How your mic works"
              onChange={(e) => setMode(e.target.value as "ptt" | "open")}
            >
              <option value="ptt">Push to talk</option>
              <option value="open">Open mic</option>
            </select>
            <button className="quiet" title="Turn your mic off" onClick={micOff}>
              Mic off
            </button>
          </>
        )}
        {others.length > 0 && (
          <button className="quiet" title="Who is in voice" onClick={() => setPeople(!people)}>
            {others.length} in voice {people ? "▴" : "▾"}
          </button>
        )}
      </div>
      {error && <p className="warn small">{error}</p>}
      {spectator && !mic && others.length > 0 && <p className="muted small">You're listening.</p>}
      {people && (
        <ul className="voice-people">
          {others.map(([id, p]) => {
            const { name, color } = who(id, p.name);
            return (
              <li key={id} className={speaking[id] ? "speaking" : ""}>
                <span className="dot" style={{ background: color }} />
                <span className="name" style={{ color }}>
                  {name}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume[id] ?? 1}
                  aria-label={`${name}'s volume`}
                  disabled={!!muted[id]}
                  onChange={(e) => setVolume(id, Number(e.target.value))}
                />
                <button
                  className="quiet"
                  title={muted[id] ? "Unmute" : "Mute"}
                  onClick={() => setMuted(id, !muted[id])}
                >
                  {muted[id] ? "🔇" : "🔊"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The streaming view: the commentator speaking, by name. */
export function OnAir() {
  const { speaking, peers } = useVoice();
  const players = useStore((s) => s.game.players);
  const on = Object.keys(speaking).filter((id) => peers[id] && !players[id]);
  if (!on.length) return null;
  return (
    <div className="on-air">
      🎙 {on.map((id) => who(id, peers[id]!.name).name.replace(/ \(watching\)$/, "")).join(" & ")}
    </div>
  );
}
