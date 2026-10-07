import { useState } from "react";
import type { Player } from "../core";
import {
  abilityReminders,
  playerActions,
  type AbilityReminder,
  type PlayerActionOption,
} from "../core/content/player";
import { phaseName, systemOf } from "../core/content/turn";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/**
 * Stratagems and ability reminders for the current phase, from the game
 * system's data and the imported rosters. Players use a stratagem here (CP
 * is spent and logged) and mark the abilities they resolved by hand.
 */
export function PlayPanel() {
  const game = useGame();
  const { scrub, role } = useStore();
  const canControl = useCanControl();
  const [open, setOpen] = useState(true);
  const system = systemOf(game);
  const reminders = abilityReminders(game);
  const stratagems = system.actions.some((a) => a.by === "player");
  if (!stratagems && !system.abilityTimings) return null;
  if (game.turn.round === 0 && !reminders.length) return null;
  const live = scrub === null && role !== "spectator";
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined && live && canControl(p.id))
    .sort((a, b) => Number(b.seat === game.turn.activeSeat) - Number(a.seat === game.turn.activeSeat));
  const phase = game.turn.round === 0 ? "Deployment" : (phaseName(game) ?? "");

  if (!open)
    return (
      <div className="panel play collapsed">
        <button onClick={() => setOpen(true)}>
          {phase}: stratagems{reminders.length ? ` · ${reminders.length} abilities` : ""}
        </button>
      </div>
    );
  return (
    <div className="panel play">
      <div className="row spread">
        <strong>{phase}: stratagems and abilities</strong>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>
      {stratagems && game.turn.round > 0 && players.map((p) => <PlayerStratagems key={p.id} player={p} />)}
      <Reminders items={reminders} live={live} empty="No abilities flagged for this phase." />
    </div>
  );
}

function PlayerStratagems({ player }: { player: Player }) {
  const game = useGame();
  const { dispatch } = useStore();
  const options = playerActions(game, player.id);
  const usable = options.filter((o) => o.ok && !o.def.custom);
  const custom = options.find((o) => o.def.custom);
  const others = options.filter((o) => !o.ok && !o.def.custom);
  const cp = game.resources[player.id]?.CP;
  return (
    <div className="stratagems">
      <p className="row spread">
        <span style={{ color: player.color }}>{player.name}</span>
        {cp !== undefined && <span className="muted">{cp} CP</span>}
      </p>
      {usable.length === 0 && <p className="muted">No core stratagems fit this moment.</p>}
      {usable.map((o) => (
        <Stratagem
          key={o.def.id}
          option={o}
          onUse={(targetId) =>
            dispatch(
              { type: "player/action", action: o.def.id, ...(targetId ? { targetId } : {}) },
              player.id,
            )
          }
        />
      ))}
      {custom?.ok && (
        <CustomStratagem
          cp={cp ?? 0}
          onUse={(label, cost) =>
            dispatch({ type: "player/action", action: custom.def.id, label, cost }, player.id)
          }
        />
      )}
      {others.length > 0 && (
        <details>
          <summary className="muted">{others.length} not usable now</summary>
          <ul className="small">
            {others.map((o) => (
              <li key={o.def.id}>
                {o.def.name} ({o.cost}): <span className="muted">{o.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stratagem({ option, onUse }: { option: PlayerActionOption; onUse: (targetId?: string) => void }) {
  const game = useGame();
  const [target, setTarget] = useState("");
  const targets = option.targets;
  return (
    <div className="stratagem">
      <div className="row spread">
        <span title={option.def.hint}>
          <strong>{option.def.name}</strong> <span className="muted">{option.cost}</span>
        </span>
        <button
          className="small"
          disabled={!!targets && !target}
          title={targets && !target ? "Pick a unit first" : undefined}
          onClick={() => {
            onUse(target || undefined);
            setTarget("");
          }}
        >
          Use
        </button>
      </div>
      {option.def.hint && <span className="muted small">{option.def.hint}</span>}
      {targets && (
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{targets.length ? "On which unit…" : "No eligible unit"}</option>
          {targets.map((id) => (
            <option key={id} value={id}>
              {game.units[id]?.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function CustomStratagem({ cp, onUse }: { cp: number; onUse: (label: string, cost: number) => void }) {
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState(1);
  return (
    <div className="row stratagem">
      <input
        placeholder="Other stratagem…"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        size={14}
      />
      <input type="number" min={0} max={3} value={cost} onChange={(e) => setCost(Number(e.target.value))} />
      CP
      <button
        className="small"
        disabled={!label.trim() || cost > cp}
        title={cost > cp ? "Not enough CP" : !label.trim() ? "Name the stratagem" : undefined}
        onClick={() => {
          onUse(label.trim(), cost);
          setLabel("");
        }}
      >
        Use
      </button>
    </div>
  );
}

/** Imported abilities the engine doesn't automate, with their text and a manual-apply button. */
export function Reminders({
  items,
  live,
  empty,
}: {
  items: AbilityReminder[];
  live: boolean;
  empty?: string;
}) {
  const game = useGame();
  const { dispatch } = useStore();
  const canControl = useCanControl();
  if (!items.length) return empty ? <p className="muted small">{empty}</p> : null;
  return (
    <ul className="reminders">
      {items.map((r) => {
        const unit = game.units[r.unitId];
        return (
          <li key={`${r.unitId}|${r.ability.name}`} className={r.applied ? "applied" : ""}>
            <details>
              <summary>
                <span style={{ color: game.players[r.owner]?.color }}>{unit?.name}</span>: {r.ability.name}
                {r.applied && " ✓"}
              </summary>
              <p className="small">{r.ability.text}</p>
            </details>
            {live && canControl(r.owner) && !r.applied && (
              <button
                className="small"
                title="Mark it resolved by hand; it shows in the log"
                onClick={() =>
                  dispatch({ type: "ability/apply", unitId: r.unitId, ability: r.ability.name }, r.owner)
                }
              >
                Apply
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
