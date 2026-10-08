import { displayName } from "../i18n/names";
import { useState } from "react";
import { narrow } from "./narrow";
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
import { t, tn, gameText } from "../i18n";

/**
 * Stratagems and ability reminders for the current phase, from the game
 * system's data and the imported rosters. Players use a stratagem here (CP
 * is spent and logged) and mark the abilities they resolved by hand.
 */
export function PlayPanel() {
  const game = useGame();
  const { scrub, role, selected, draft } = useStore();
  const canControl = useCanControl();
  // The user's own open/closed choice, kept until the selection changes.
  const busy = !!selected || !!draft || !!game.attack || !!game.procedure;
  const context = `${selected ?? ""}|${busy}`;
  const [choice, setChoice] = useState<{ context: string; open: boolean } | null>(null);
  // On a phone it opens only when asked (UX 17).
  const open = choice?.context === context ? choice.open : !busy && !narrow();
  const setOpen = (o: boolean) => setChoice({ context, open: o });
  const system = systemOf(game);
  const reminders = abilityReminders(game);
  const stratagems = system.actions.some((a) => a.by === "player");
  // Players' own tool: not for spectators or replays.
  if (role === "spectator" || scrub !== null) return null;
  if (!stratagems && !system.abilityTimings) return null;
  if (game.turn.round === 0 && !reminders.length) return null;
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined && canControl(p.id))
    .sort((a, b) => Number(b.seat === game.turn.activeSeat) - Number(a.seat === game.turn.activeSeat));
  const phase = game.turn.round === 0 ? t("Deployment") : gameText(phaseName(game) ?? "");
  // Systems with only a custom player action (FSD's support cards) are named for it.
  const core = system.actions.some((a) => a.by === "player" && !a.custom);
  const customName = system.actions.find((a) => a.by === "player" && a.custom)?.name;
  const cards = !core && customName ? `${customName.toLowerCase()}s` : null;
  const usable = players.reduce(
    (n, p) => n + playerActions(game, p.id).filter((o) => o.ok && !o.def.custom).length,
    0,
  );

  if (!open)
    return (
      <div className="panel play collapsed">
        <button onClick={() => setOpen(true)}>
          {cards
            ? t("{phase}: {cards}", { phase, cards })
            : tn(usable, "{phase}: {n} stratagem", "{phase}: {n} stratagems", { phase })}
          {reminders.length ? " · " + tn(reminders.length, "{n} ability", "{n} abilities") : ""}
        </button>
      </div>
    );
  return (
    <div className="panel play">
      <div className="row spread">
        <strong>
          {cards
            ? t("{phase}: {cards} and abilities", { phase, cards })
            : t("{phase}: stratagems and abilities", { phase })}
        </strong>
        <button onClick={() => setOpen(false)}>{t("Hide")}</button>
      </div>
      {stratagems &&
        game.turn.round > 0 &&
        players.map((p, i) => <PlayerStratagems key={p.id} player={p} brief={i > 0} />)}
      <Reminders items={reminders} live empty={t("No abilities flagged for this phase.")} />
    </div>
  );
}

/** One player's stratagems; `brief` (the other player in hotseat) folds them into one line. */
function PlayerStratagems({ player, brief }: { player: Player; brief: boolean }) {
  const game = useGame();
  const { dispatch } = useStore();
  const options = playerActions(game, player.id);
  const usable = options.filter((o) => o.ok && !o.def.custom);
  const custom = options.find((o) => o.def.custom);
  const others = options.filter((o) => !o.ok && !o.def.custom);
  const cp = game.resources[player.id]?.CP;
  const system = systemOf(game);
  const core = system.actions.some((a) => a.by === "player" && !a.custom);
  // What the custom action is paid with: CP, or dice from a pool (FSD support cards).
  const payWith = system.resources?.find((r) => r.id === custom?.def.cost?.[0]?.resource);
  const have =
    payWith?.kind === "dicePool"
      ? (game.pools?.[player.id]?.[payWith.id]?.length ?? 0)
      : (game.resources[player.id]?.[payWith?.id ?? "CP"] ?? 0);
  const list = (
    <>
      {core && usable.length === 0 && <p className="muted">{t("No core stratagems fit this moment.")}</p>}
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
      {!core && custom?.why === "Not in this phase" && (
        <p className="muted small">
          {t("No {cards} in this phase.", { cards: `${custom.def.name.toLowerCase()}s` })}
        </p>
      )}
      {custom?.ok && (
        <CustomStratagem
          cp={have}
          unit={payWith?.short ?? payWith?.name ?? t("CP")}
          placeholder={core ? t("Other stratagem…") : `${custom.def.name}…`}
          {...(payWith?.kind === "dicePool" ? { faces: game.pools?.[player.id]?.[payWith.id] ?? [] } : {})}
          onUse={(label, cost, dice) =>
            dispatch(
              { type: "player/action", action: custom.def.id, label, cost, ...(dice ? { dice } : {}) },
              player.id,
            )
          }
        />
      )}
      {others.length > 0 && (
        <details>
          <summary className="muted">{tn(others.length, "{n} not usable now", "{n} not usable now")}</summary>
          <ul className="small">
            {others.map((o) => (
              <li key={o.def.id}>
                {gameText(o.def.name)} ({o.cost}): <span className="muted">{o.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
  if (brief)
    return (
      <details className="stratagems">
        <summary>
          <span style={{ color: player.color }}>{displayName(player.name)}</span>
          {usable.length
            ? " " +
              t("can react: {stratagems}", { stratagems: usable.map((o) => gameText(o.def.name)).join(", ") })
            : `: ${t("nothing to react with")}`}
          {cp !== undefined && <span className="muted"> {t("({cp} CP)", { cp })}</span>}
        </summary>
        {list}
      </details>
    );
  return (
    <div className="stratagems">
      <p className="row spread">
        <span style={{ color: player.color }}>{displayName(player.name)}</span>
        {cp !== undefined && <span className="muted">{t("{cp} CP", { cp })}</span>}
      </p>
      {list}
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
        <span title={option.def.hint && gameText(option.def.hint)}>
          <strong>{gameText(option.def.name)}</strong> <span className="muted">{option.cost}</span>
        </span>
        <button
          className="small"
          disabled={!!targets && !target}
          title={targets && !target ? t("Pick a unit first") : undefined}
          onClick={() => {
            onUse(target || undefined);
            setTarget("");
          }}
        >
          {t("Use")}
        </button>
      </div>
      {option.def.hint && <span className="muted small">{gameText(option.def.hint)}</span>}
      {targets && (
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t("On which unit…")}</option>
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

function CustomStratagem({
  cp,
  unit,
  placeholder,
  faces,
  onUse,
}: {
  cp: number;
  unit: string;
  placeholder: string;
  /** Paid from a dice pool: its faces, so the player picks which dice to spend (UX 269). */
  faces?: number[];
  onUse: (label: string, cost: number, dice?: number[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [typed, setCost] = useState(1);
  const [picked, setPicked] = useState<number[]>([]);
  const cost = faces && picked.length ? picked.length : typed;
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <div className="stratagem custom">
      <div className="row">
        <label className="small">
          {t("Name")}{" "}
          <input
            placeholder={placeholder}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            size={14}
          />
        </label>
        {!(faces && picked.length) && (
          <label className="small">
            {t("Cost")}{" "}
            <input
              type="number"
              min={0}
              max={3}
              value={typed}
              onChange={(e) => setCost(Number(e.target.value))}
            />{" "}
            {unit}
          </label>
        )}
        <button
          className="small"
          disabled={!label.trim() || cost > cp}
          title={
            cost > cp
              ? t("Not enough {resource}", { resource: unit })
              : !label.trim()
                ? t("Name it first")
                : undefined
          }
          onClick={() => {
            onUse(label.trim(), cost, faces && picked.length ? picked : undefined);
            setLabel("");
            setPicked([]);
          }}
        >
          {t("Use")}
        </button>
      </div>
      {faces && faces.length > 0 && (
        <div className="row small" role="group" aria-label={t("Dice to spend")}>
          <span className="muted">
            {picked.length
              ? t("Spends these {resource}:", { resource: unit })
              : t("Pick the {resource} to spend, or the lowest go:", { resource: unit })}
          </span>
          {faces.map((f, i) => (
            <button
              key={i}
              className={`die ${picked.includes(i) ? "on" : ""}`}
              aria-pressed={picked.includes(i)}
              onClick={() => toggle(i)}
            >
              {f}
            </button>
          ))}
        </div>
      )}
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
                title={t("Mark it resolved by hand; it shows in the log")}
                onClick={() =>
                  dispatch({ type: "ability/apply", unitId: r.unitId, ability: r.ability.name }, r.owner)
                }
              >
                {t("Apply")}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
