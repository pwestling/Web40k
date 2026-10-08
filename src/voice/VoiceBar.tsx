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
 * Voice in the talk bar's row (UX 166): 🎙 turns the mic on, then is the
 * hold-to-talk button (or shows the open mic). ▾ opens the rest: push to
 * talk or open mic, mic off, and everyone in voice with a mute and a volume
 * each. Spectators listen until they choose to speak.
 */
export function VoiceButton() {
  const media = useStore((s) => !!s.session?.media);
  const spectator = useStore((s) => s.role === "spectator");
  const me = useStore((s) => s.session?.selfId ?? "");
  useStore((s) => s.game.players);
  const { mic, mode, live, error, peers, speaking, muted, volume, used } = useVoice();
  const [menu, setMenu] = useState(false);
  if (!media) return null;
  const others = Object.entries(peers).filter(([id]) => id !== me);
  const ptt = mic && mode === "ptt";

  return (
    <span className="voice-controls">
      <button
        className={`quiet mic${mic ? " on" : ""}${live ? " live" : ""}${speaking[me] ? " speaking" : ""}`}
        title={
          !mic
            ? spectator
              ? "Speak too: talk to the table with your microphone"
              : "Voice: talk to the table with your microphone"
            : ptt
              ? "Hold to talk (or hold V)"
              : "Your mic is open"
        }
        aria-pressed={live}
        onClick={() => {
          if (!mic) void micOn();
          else if (!ptt) setMenu(!menu);
        }}
        onPointerDown={() => ptt && pushToTalk(true)}
        onPointerUp={() => ptt && pushToTalk(false)}
        onPointerLeave={() => ptt && pushToTalk(false)}
      >
        {used ? "🎙" : spectator ? "🎙 Speak" : "🎙 Voice"}
      </button>
      {(mic || others.length > 0 || error) && (
        <button
          className="quiet voice-more"
          title="Voice settings and who is in voice"
          onClick={() => setMenu(!menu)}
        >
          {others.length > 0 ? others.length : ""}▾
        </button>
      )}
      {(menu || error) && (
        <div className="panel voice-pop">
          <button
            className="quiet close"
            title="Close"
            onClick={() => {
              setMenu(false);
              useVoice.setState({ error: null });
            }}
          >
            ✕
          </button>
          {error && <p className="warn small">{error}</p>}
          {mic ? (
            <div className="row">
              <select
                value={mode}
                aria-label="How your mic works"
                onChange={(e) => setMode(e.target.value as "ptt" | "open")}
              >
                <option value="ptt">Push to talk (hold 🎙 or V)</option>
                <option value="open">Open mic</option>
              </select>
              <button className="quiet" onClick={micOff}>
                Mic off
              </button>
            </div>
          ) : (
            <p className="muted small">
              {spectator ? "You're listening. 🎙 to speak too." : "🎙 turns your mic on."}
            </p>
          )}
          {others.length > 0 && (
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
      )}
    </span>
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
