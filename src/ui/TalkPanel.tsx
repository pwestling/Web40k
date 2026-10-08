import { VoiceBar } from "../voice/VoiceBar";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { clearMine, MAX_CHAT, REACTIONS, say, useTableTalk, useTalk, type Said } from "../talk/talk";

const TOOLS = [
  { id: "ping", label: "📍 Ping", title: "Click a spot or a unit to ping it (or Alt-click any time)" },
  { id: "arrow", label: "↗ Arrow", title: "Drag on the table to draw an arrow" },
  { id: "area", label: "◯ Area", title: "Drag out from a centre to mark an area" },
] as const;

/**
 * Table talk: point at things, draw on the table, chat and react. None of it
 * is part of the game: it isn't logged, replayed or checked, and it fades.
 */
export function TalkPanel() {
  useTableTalk();
  const { chat, unread, open, tool } = useTalk();
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, open]);
  const send = () => {
    if (!text.trim()) return;
    say({ kind: "chat", text: text.trim().slice(0, MAX_CHAT) });
    setText("");
  };
  const setOpen = (o: boolean) => useTalk.setState(o ? { open: true, unread: 0 } : { open: false });
  const pick = (t: (typeof TOOLS)[number]["id"]) => useTalk.setState({ tool: tool === t ? null : t });

  return (
    <div className="talk-dock">
      <ChatToasts chatOpen={open} />
      <VoiceBar />
      <div className={`panel talk${open ? "" : " collapsed"}`}>
        <div className="row wrap">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? "on" : ""}
              title={t.title}
              onClick={() => pick(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button className="quiet" title="Wipe your arrows and areas" onClick={clearMine}>
            Clear
          </button>
          <button className="quiet talk-toggle" onClick={() => setOpen(!open)} title="Chat">
            💬{unread > 0 ? ` ${unread}` : ""}
          </button>
        </div>
        <div className="row talk-reactions-row">
          {REACTIONS.map((e) => (
            <button key={e} className="quiet" title="React" onClick={() => say({ kind: "react", emoji: e })}>
              {e}
            </button>
          ))}
        </div>
        {open && (
          <>
            <ol className="talk-chat" ref={list}>
              {chat.length === 0 && (
                <li className="muted small">Messages here aren't part of the game log.</li>
              )}
              {chat.map((c) => (
                <li key={`${c.by}:${c.id}`}>
                  <strong style={{ color: c.color }}>{c.name}:</strong> {c.kind === "chat" ? c.text : ""}
                </li>
              ))}
            </ol>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={text}
                maxLength={MAX_CHAT}
                placeholder="Say something…"
                aria-label="Chat message"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLInputElement).blur()}
              />
              <button type="submit" disabled={!text.trim()}>
                Send
              </button>
            </form>
          </>
        )}
      </div>
      <FloatingReactions />
    </div>
  );
}

/** New chat lines while the chat is closed, and unit pings, for a few seconds each. */
function ChatToasts({ chatOpen }: { chatOpen: boolean }) {
  const items = useTalk((s) => s.items);
  const units = useStore((s) => s.game.units);
  const lines = items
    .filter((i) => (i.kind === "chat" && !chatOpen) || (i.kind === "ping" && i.unitId && units[i.unitId]))
    .slice(-3);
  if (!lines.length) return null;
  return (
    <ol className="talk-toasts">
      {lines.map((c) => (
        <li key={`${c.by}:${c.id}`} onClick={() => useTalk.setState({ open: true, unread: 0 })}>
          {c.kind === "chat" ? (
            <>
              <strong style={{ color: c.color }}>{c.name}:</strong> {c.text}
            </>
          ) : (
            <span className="muted">
              <strong style={{ color: c.color }}>{c.name}</strong> pinged{" "}
              {c.kind === "ping" && c.unitId ? units[c.unitId]?.name : "a spot"}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Reactions rise over the board and fade. */
export function FloatingReactions() {
  const items = useTalk((s) => s.items);
  const reacts = items.filter((i): i is Extract<Said, { kind: "react" }> => i.kind === "react");
  return (
    <div className="talk-floats" aria-live="polite">
      {reacts.map((r) => (
        <div key={`${r.by}:${r.id}`} className="talk-float" style={{ left: `${spread(r.id + r.by)}%` }}>
          <span className="emoji">{r.emoji}</span>
          <span className="who" style={{ color: r.color }}>
            {r.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A steady spot across the middle of the screen for each reaction, so a burst doesn't stack. */
function spread(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return 35 + (Math.abs(h) % 30);
}
