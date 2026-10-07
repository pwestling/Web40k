import { useState } from "react";
import type { GameState, Player, Unit } from "../../core";
import { currentSlot } from "../../core/content/turn";
import { useCanControl, useStore } from "../../store";
import { useGame } from "../../ui/hooks";
import { cardsLeft, nextCard, stackOf } from "./command";
import { conquest } from "./system";

const alive = (game: GameState, u: Unit) =>
  u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed);

/**
 * The command stack. In the Command phase each player puts their regiments'
 * cards in order (top card first) and locks it in; in the Action phase it
 * shows whose card is next. The other player's order stays hidden: only how
 * many cards they have left shows.
 */
export function CommandPanel() {
  const game = useGame();
  const { role, scrub, select } = useStore();
  const canControl = useCanControl();
  const [open, setOpen] = useState(true);
  if (game.system !== conquest.id || game.turn.round === 0 || scrub !== null) return null;
  const slot = currentSlot(game)?.id;
  const own = game.modules?.[conquest.id] ?? {};
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const mine = (p: Player) => role !== "spectator" && canControl(p.id);

  if (!open)
    return (
      <div className="panel play command-stack collapsed">
        <button onClick={() => setOpen(true)}>Command stack</button>
      </div>
    );
  return (
    <div className="panel play command-stack">
      <div className="row spread">
        <strong>Command stack</strong>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>
      {players.map((p) => {
        const stack = stackOf(game, own, p.id);
        if (slot === "command" && mine(p)) return <Ordering key={p.id} player={p} saved={stack} />;
        const next = nextCard(game, stack);
        return (
          <div key={p.id} className="stack-player">
            <span style={{ color: p.color }}>{p.name}</span>{" "}
            {!stack ? (
              <span className="muted">
                {slot === "command" ? "ordering their cards" : "no stack: any regiment"}
              </span>
            ) : (
              <span className="muted">
                {cardsLeft(game, stack)} card{cardsLeft(game, stack) === 1 ? "" : "s"} left
              </span>
            )}
            {slot !== "command" && next && mine(p) && p.seat === game.turn.activeSeat && (
              <div className="row">
                <span className="muted">Next card:</span>
                <button onClick={() => select(next.id)}>{next.name}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One player's cards in order, to rearrange and lock in. */
function Ordering({ player, saved }: { player: Player; saved: string[] | undefined }) {
  const game = useGame();
  const { dispatch } = useStore();
  const [draft, setDraft] = useState<string[] | null>(null);
  const units = Object.values(game.units).filter((u) => u.owner === player.id && alive(game, u));
  const ids = new Set(units.map((u) => u.id));
  // The saved order first (regiments still standing), then any not in it yet.
  const base = [
    ...(saved ?? []).filter((id) => ids.has(id)),
    ...units.map((u) => u.id).filter((id) => !saved?.includes(id)),
  ];
  const order = (draft ?? base).filter((id) => ids.has(id));
  const locked = !!saved && draft === null;
  const move = (i: number, d: -1 | 1) => {
    const next = order.slice();
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setDraft(next);
  };
  const lock = () => {
    dispatch({ type: "script/start", procedure: "setStack", args: { player: player.id, order } }, player.id);
    setDraft(null);
  };
  return (
    <div className="stack-player">
      <span style={{ color: player.color }}>{player.name}</span>{" "}
      <span className="muted">{locked ? "locked in" : "top card first"}</span>
      <ol className="stack-cards">
        {order.map((id, i) => (
          <li key={id}>
            <span>{game.units[id]?.name}</span>
            <button aria-label="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button aria-label="Later" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      <button className={locked ? undefined : "primary"} disabled={locked || !!game.script} onClick={lock}>
        {locked ? "Locked in" : "Lock in stack"}
      </button>
    </div>
  );
}
