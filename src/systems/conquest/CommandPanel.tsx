import { useState } from "react";
import type { GameState, Player, Unit } from "../../core";
import { currentSlot } from "../../core/content/turn";
import { useCanControl, useStore } from "../../store";
import { useGame } from "../../ui/hooks";
import { cardsLeft, nextCard, stackOf } from "./command";
import {
  arrivalTarget,
  atEdge,
  classOf,
  CLASSES,
  needsRoll,
  reservesOf,
  rolledKey,
  type UnitClass,
} from "./reinforce";
import { conquest } from "./system";

const alive = (game: GameState, u: Unit) =>
  !u.status?.reserves && u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed);

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
  if (game.system !== conquest.id || scrub !== null) return null;
  const slot = currentSlot(game)?.id;
  const own = game.modules?.[conquest.id] ?? {};
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const mine = (p: Player) => role !== "spectator" && canControl(p.id);
  if (game.turn.round === 0) return <ToReserve players={players.filter(mine)} />;

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
        if (slot === "command" && mine(p)) {
          const waiting = needsRoll(game, own, p.id);
          return waiting ? (
            <Reinforcements key={p.id} player={p} />
          ) : (
            <div key={p.id}>
              <Arrived player={p} />
              <Ordering player={p} saved={stack} />
            </div>
          );
        }
        const next = nextCard(game, stack);
        return (
          <div key={p.id} className="stack-player">
            <span style={{ color: p.color }}>{p.name}</span>{" "}
            {reservesOf(game, p.id).length > 0 && (
              <span className="muted">{reservesOf(game, p.id).length} in reserve · </span>
            )}
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

/** Before the battle: Conquest armies start in reserve and arrive round by round. */
function ToReserve({ players }: { players: Player[] }) {
  const game = useGame();
  const { dispatch } = useStore();
  const rows = players
    .map((p) => ({ p, units: Object.values(game.units).filter((u) => u.owner === p.id) }))
    .filter((r) => r.units.length);
  if (!rows.length) return null;
  const toReserve = (u: Unit) => dispatch({ type: "unit/reserve", id: u.id, reserve: true }, u.owner);
  // Back on the table: just inside its owner's edge, where it waited.
  const toTable = (u: Unit) => {
    dispatch({ type: "unit/reserve", id: u.id, reserve: false }, u.owner);
    const moves = atEdge(useStore.getState().game, u);
    if (moves.length) dispatch({ type: "models/move", moves }, u.owner);
  };
  return (
    <div className="panel play command-stack">
      <strong>Reinforcements</strong>
      <p className="muted small">
        Regiments start in reserve: Light from round 1, Medium from round 2, Heavy from round 3. Untick one to
        keep it on the table.
      </p>
      {rows.map(({ p, units }) => {
        const table = units.filter((u) => !u.status?.reserves);
        return (
          <div key={p.id} className="stack-player">
            <div className="row spread">
              <span style={{ color: p.color }}>{p.name}</span>
              {table.length > 0 && (
                <button
                  className={table.length === units.length ? "primary" : undefined}
                  onClick={() => table.forEach(toReserve)}
                >
                  {table.length === units.length ? "Send all to reserve" : "Rest to reserve"}
                </button>
              )}
            </div>
            <ul className="reserve-list">
              {units.map((u) => (
                <li key={u.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!u.status?.reserves}
                      onChange={(e) => (e.target.checked ? toReserve(u) : toTable(u))}
                    />{" "}
                    {u.name} <span className="muted small">{classOf(u, game)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** This round's arrivals: one regiment of each class comes in, the rest roll. */
function Reinforcements({ player }: { player: Player }) {
  const game = useGame();
  const { dispatch } = useStore();
  const [first, setFirst] = useState<Partial<Record<UnitClass, string>>>({});
  const round = game.turn.round;
  const rows = CLASSES.map((cls) => ({
    cls,
    target: arrivalTarget(round, cls),
    waiting: reservesOf(game, player.id).filter((u) => classOf(u, game) === cls),
  })).filter((r) => r.target !== null && r.waiting.length);
  const roll = () =>
    dispatch(
      { type: "script/start", procedure: "reinforcements", args: { player: player.id, first } },
      player.id,
    );
  return (
    <div className="stack-player">
      <span style={{ color: player.color }}>{player.name}</span>{" "}
      <span className="muted">reinforcements, round {round}</span>
      {rows.map(({ cls, target, waiting }) => (
        <div key={cls} className="row small">
          <span>
            {cls}: {waiting.length > 1 ? "" : "arrives"}
          </span>
          {waiting.length > 1 && (
            <select
              aria-label={`${cls} regiment that arrives without a roll`}
              value={first[cls] ?? waiting[0]!.id}
              onChange={(e) => setFirst({ ...first, [cls]: e.target.value })}
            >
              {waiting.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          {waiting.length > 1 && (
            <span className="muted">
              {target === "auto" ? "arrive with the rest" : `arrives; the rest on ${target} or less`}
            </span>
          )}
        </div>
      ))}
      <button className="primary" disabled={!!game.script} onClick={roll}>
        {rows.some((r) => r.target !== "auto" && r.waiting.length > 1)
          ? "Roll reinforcements"
          : "Bring them in"}
      </button>
    </div>
  );
}

/** Who arrived this round, until they're on the table. */
function Arrived({ player }: { player: Player }) {
  const game = useGame();
  const own = game.modules?.[conquest.id] ?? {};
  const ids = own[rolledKey(player.id, game.turn.round)];
  if (!Array.isArray(ids) || !ids.length) return null;
  return (
    <p className="muted small">
      Arrived: {ids.map((id) => game.units[String(id)]?.name).join(", ")}. They stand just inside your table
      edge; each marches first and can't charge this round.
    </p>
  );
}
