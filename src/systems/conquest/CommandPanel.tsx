import { useEffect, useRef, useState } from "react";
import { computerPlays } from "../../teach/store";
import type { GameState, Player, Unit } from "../../core";
import { currentSlot } from "../../core/content/turn";
import { useCanControl, useStore } from "../../store";
import { useGame } from "../../ui/hooks";
import { localSecret, keepSecret, useLocalSecrets } from "../../secrets/local";
import { hear } from "../../talk/talk";
import { cardKey, cardsLeft, nextCard, stackOf, type Card } from "./command";
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
 * shows whose card is next. Each card is a secret kept on its owner's device
 * (command.ts): the other player, the host and spectators see only how many
 * cards are left, until a card is drawn.
 */
export function CommandPanel() {
  const game = useGame();
  const { role, scrub, select } = useStore();
  const canControl = useCanControl();
  const [open, setOpen] = useState(true);
  useDrawPings(game, game.system === conquest.id && scrub === null);
  if (game.system !== conquest.id || scrub !== null) return null;
  const slot = currentSlot(game)?.id;
  const own = game.modules?.[conquest.id] ?? {};
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  // In a lesson the computer's stack is its own secret, as at a real table.
  const mine = (p: Player) => role !== "spectator" && canControl(p.id) && !computerPlays(game, p.id);
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
        const stack = stackOf(game, p.id);
        // A branched game (core/branch.ts) starts without the stacks, which stayed on their owners' devices.
        if ((slot === "command" || (!stack && game.branch?.droppedSecrets)) && mine(p)) {
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
                {faceDown(stack)} face down
                {cardsLeft(game, stack) === 0 && " · all played"}
              </span>
            )}
            {/* The drawn card, on every screen (UX 132): hover it to ring the regiment. */}
            {slot !== "command" && next?.unitId && <Drawn unitId={next.unitId} select={select} />}
            {slot !== "command" && next && !next.unitId && mine(p) && p.seat === game.turn.activeSeat && (
              <NextCard player={p} stack={stack!} next={next} select={select} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Cards still face down (UX 133: drawing one counts down). */
const faceDown = (stack: Card[]) => stack.filter((c) => !c.unitId).length;

/** The card just drawn, named for everyone; hovering it rings the regiment on the table. */
function Drawn({ unitId, select }: { unitId: string; select: (id: string) => void }) {
  const game = useGame();
  const set = useStore((s) => s.set);
  const unit = game.units[unitId];
  if (!unit) return null;
  return (
    <div className="row">
      <span className="muted">Drawn:</span>
      <button
        onClick={() => select(unitId)}
        onMouseEnter={() => set({ hoverModels: unit.modelIds })}
        onMouseLeave={() => set({ hoverModels: null })}
      >
        {unit.name}
      </button>
    </div>
  );
}

/**
 * When a command card is drawn, a ping marks its regiment on every screen
 * (UX 132). Only for draws seen live: cards drawn before this page loaded don't ping.
 */
function useDrawPings(game: GameState, on: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const drawn = Object.entries(game.secrets ?? {}).flatMap(([player, mine]) =>
      Object.entries(mine)
        .filter(([key, e]) => key.startsWith("stack:") && e.revealed)
        .map(([key, e]) => ({ id: `${player}:${key}`, player, unitId: String(e.revealed!.value) })),
    );
    if (!seen.current) {
      seen.current = new Set(drawn.map((d) => d.id));
      return;
    }
    for (const d of drawn) {
      if (seen.current.has(d.id)) continue;
      seen.current.add(d.id);
      const unit = game.units[d.unitId];
      const models = unit?.modelIds.map((id) => game.models[id]).filter((m) => m && !m.destroyed) ?? [];
      if (!on || !models.length) continue;
      const at = {
        x: models.reduce((n, m) => n + m!.position.x, 0) / models.length,
        y: models.reduce((n, m) => n + m!.position.y, 0) / models.length,
      };
      hear({ id: `draw-${d.id}`, kind: "ping", at, unitId: d.unitId }, d.player);
    }
  }, [game, on]);
}

/** One player's cards in order, to rearrange and lock in. */
function Ordering({ player, saved: cards }: { player: Player; saved: Card[] | undefined }) {
  const game = useGame();
  const { dispatch } = useStore();
  const [draft, setDraft] = useState<string[] | null>(null);
  useLocalSecrets((s) => s.kept);
  // The order as this device committed it (another device's commitments can't be read here).
  const saved = cards?.map((c) => String(localSecret(c.commitment)?.value ?? ""));
  const units = Object.values(game.units).filter((u) => u.owner === player.id && alive(game, u));
  const ids = new Set(units.map((u) => u.id));
  // The saved order first (regiments still standing), then any not in it yet.
  const base = [
    ...(saved ?? []).filter((id) => ids.has(id)),
    ...units.map((u) => u.id).filter((id) => !saved?.includes(id)),
  ];
  const order = (draft ?? base).filter((id) => ids.has(id));
  const locked = !!cards;
  const move = (i: number, d: -1 | 1) => {
    const next = order.slice();
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setDraft(next);
  };
  // Each card is committed on its own, so each can be revealed on its own when drawn.
  const lock = () => {
    const secrets = order.map((id, i) => ({ key: cardKey(game.turn.round, i), commitment: keepSecret(id) }));
    dispatch({ type: "secret/commit", player: player.id, secrets, label: "their command stack" }, player.id);
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
      {cards && saved?.some((id) => !id) && (
        <p className="muted small">Locked in on another device: only that device can draw these cards.</p>
      )}
      <button className={locked ? undefined : "primary"} disabled={!!cards || !!game.script} onClick={lock}>
        {locked ? "Locked in" : "Lock in stack"}
      </button>
    </div>
  );
}

/**
 * The owner's top card. Face down, only this device knows it: Draw reveals it
 * to the table (and any cards before it whose regiment has fallen since).
 */
function NextCard({
  player,
  stack,
  next,
  select,
}: {
  player: Player;
  stack: Card[];
  next: Card;
  select: (id: string) => void;
}) {
  const game = useGame();
  const { dispatch } = useStore();
  useLocalSecrets((s) => s.kept);
  const top = localSecret(next.commitment);
  if (!top) return <p className="muted small">Your cards are on the device that locked them in.</p>;
  const draw = () => {
    for (const c of stack.slice(stack.indexOf(next))) {
      const kept = localSecret(c.commitment);
      if (!kept || c.unitId) continue;
      dispatch(
        {
          type: "secret/reveal",
          player: player.id,
          key: c.key,
          value: kept.value,
          salt: kept.salt,
          label: "their command card",
        },
        player.id,
      );
      const u = game.units[String(kept.value)];
      if (u && alive(game, u) && !u.status?.activated) {
        select(u.id);
        return;
      }
    }
  };
  return (
    <div className="row">
      <span className="muted">Top card: {game.units[String(top.value)]?.name ?? "a fallen regiment"}</span>
      <button className="primary" onClick={draw}>
        Draw it
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
    dispatch({ type: "unit/reserve", id: u.id, reserve: false, moves: atEdge(game, u) }, u.owner);
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
