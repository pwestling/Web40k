import { useEffect, useState, type CSSProperties } from "react";
import type { GameState, Intent, PlayerId, ReactionTrigger } from "../core";
import {
  mayReact,
  playableReactions,
  reactionWindow,
  type PlayableReaction,
  type ReactionWindowView,
} from "../core/content/reactions";
import { useRealDice } from "../companion/RealDice";
import { gameText, t } from "../i18n";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { releaseReactionHold, startReactionHold, useReactionHeld } from "./reactionHold";
import { coin, thunk } from "./sound";
import { computerPlays } from "../teach/store";

/**
 * Reactions by the dice (#80, PX stratagem-hand.md §3): when the engine opens
 * a reaction window for this screen's player, up to three cards rise by the
 * dice ("Re-roll this? · 1 CP", Counter-offensive after an enemy has fought).
 * The other side's screen shows "Ben may react…" and holds its Roll and ▶ for
 * a short beat (the window's `hold`), with "Go on" to stop waiting. The engine
 * only opens a window when something is playable and not muted, so this never
 * nags. FSD's held action and code procedures' questions keep their own panels.
 */

/** The engine window this screen's player may answer, if any. */
function myWindow(
  game: GameState,
  canControl: (id: PlayerId) => boolean,
): { open: ReactionWindowView; me: PlayerId } | null {
  const open = reactionWindow(game);
  if (!open || open.source !== "window") return null;
  const me = Object.values(game.players).find((p) => p.seat === open.seat && canControl(p.id));
  return me ? { open, me: me.id } : null;
}

const unitName = (game: GameState, id: string | undefined) => (id ? (game.units[id]?.name ?? "") : "");

/** What just happened, in a line: why the card is up. */
function why(game: GameState, window: string, trigger: ReactionTrigger): string {
  const unit = unitName(game, trigger.unitId);
  const target = unitName(game, trigger.targetId);
  switch (window) {
    case "rerollable":
      return t("Re-roll this?");
    case "targetDeclared":
      return target ? t("{unit} targets {target}", { unit, target }) : t("{unit} attacks", { unit });
    case "beforeSaves":
      return t("Saves for {unit} next", { unit: target || unit });
    case "fightPick":
      return t("{unit} has fought", { unit });
    case "chargeRolled":
      return trigger.total !== undefined
        ? t("{unit} rolled {n} to charge", { unit, n: trigger.total })
        : t("{unit} charges", { unit });
    case "chargeDeclared":
      return t("{unit} declares a charge", { unit });
    case "moveEnded":
      return t("{unit} has moved", { unit });
    case "movementEnded":
      return t("Their moves are done");
    default:
      return t("You may react");
  }
}

export function ReactionCard() {
  const game = useGame();
  const scrub = useStore((s) => s.scrub);
  const dispatch = useStore((s) => s.dispatch);
  const canControl = useCanControl();
  const ownDice = useRealDice();
  const [telling, setTelling] = useState<{ id: string; die: number } | null>(null);
  const mine = scrub === null ? myWindow(game, canControl) : null;
  if (!mine) return null;
  const { open, me } = mine;
  // The most likely first: a re-roll by the dice, then the rest as the engine lists them. At most three.
  const cards = playableReactions(game, me)
    .filter((r) => !r.muted)
    .sort((a, b) => Number(!!b.reroll) - Number(!!a.reroll))
    .slice(0, 3);
  if (!cards.length) return null;
  const style = { "--side": game.players[me]?.color } as CSSProperties;

  const play = (r: PlayableReaction, unit?: string, die?: number, told?: number) => {
    dispatch(r.needsUnit && unit ? ({ ...r.play, targetId: unit } as Intent) : r.play, me);
    if (r.reroll && die !== undefined) {
      const intent = { type: "attack/reroll", seq: r.reroll.seq, die } as Intent;
      dispatch((told !== undefined ? { ...intent, told: [told] } : intent) as Intent, me);
    }
    coin();
    thunk(1);
    setTelling(null);
  };

  return (
    <div
      className="reaction-cards"
      role="group"
      aria-label={why(game, open.window, open.trigger)}
      style={style}
    >
      <span className="muted small">{why(game, open.window, open.trigger)}</span>
      {cards.map((r) => {
        // A re-roll offers each failed face once; a unit's reaction, each unit it can go on.
        const faces = r.reroll
          ? r.reroll.dice.filter((d, i, all) => all.findIndex((x) => x.value === d.value) === i)
          : [];
        faces.sort((a, b) => a.value - b.value);
        const asking = telling?.id === r.id;
        return (
          <div key={r.id} className="reroll-card reaction-card dice-ask" style={style}>
            {r.cost && <span className="cost">{r.cost}</span>}
            <strong>{gameText(r.name)}</strong>
            {asking ? (
              <>
                <span>{t("Roll one die. What did it show?")}</span>
                <div className="row">
                  {Array.from({ length: open.trigger.sides ?? 6 }, (_, i) => (
                    <button
                      key={i}
                      className="small die-face"
                      onClick={() => play(r, undefined, telling.die, i + 1)}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button className="small quiet" onClick={() => setTelling(null)}>
                    {t("Back")}
                  </button>
                </div>
              </>
            ) : (
              <div className="row">
                {r.reroll
                  ? faces.map(({ value, die }) => (
                      <button
                        key={die}
                        className="small primary"
                        onClick={() => (ownDice ? setTelling({ id: r.id, die }) : play(r, undefined, die))}
                      >
                        {t("Re-roll a {face}", { face: value })}
                      </button>
                    ))
                  : r.needsUnit
                    ? r.units.slice(0, 4).map((u) => (
                        <button key={u} className="small primary" onClick={() => play(r, u)}>
                          {r.units.length > 1 ? unitName(game, u) : t("Play it")}
                        </button>
                      ))
                    : [
                        <button key="play" className="small primary" onClick={() => play(r)}>
                          {t("Play it")}
                        </button>,
                      ]}
                <button
                  className="link quiet small"
                  title={t("Don't ask me this game")}
                  onClick={() => dispatch({ type: "reaction/mute", action: r.id, mute: true }, me)}
                >
                  {t("Don't ask me this game")}
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button className="small" onClick={() => dispatch({ type: "reaction/pass" }, me)}>
        {t("No")}
      </button>
    </div>
  );
}

/**
 * The other side's screen: a face-down card by the dice, "Ben may react…",
 * while the hold drains. It never says which card (stratagems are public at a
 * real table, but which one is the reactor's to reveal).
 */
export function MayReact() {
  const game = useGame();
  const scrub = useStore((s) => s.scrub);
  const self = useStore((s) => s.session?.selfId ?? null);
  const canControl = useCanControl();
  const held = useReactionHeld();
  const open = game.reaction ?? null;
  // In hotseat both sides are this screen's: the reactor's card is up already.
  const viewer =
    self ?? Object.values(game.players).find((p) => p.seat !== undefined && canControl(p.id))?.id;
  const other = viewer && scrub === null && !myWindow(game, canControl) ? mayReact(game, viewer) : null;
  const opened =
    other && open && !computerPlays(game, Object.values(game.players).find((p) => p.seat === other.seat)?.id)
      ? open.opened
      : null;
  const hold = open?.hold ?? 0;
  useEffect(() => {
    if (opened === null) return;
    // Counted on this screen from when it saw the window: the host's clock and this one may differ.
    startReactionHold(opened, hold);
  }, [opened, hold]);
  const reactor = other ? Object.values(game.players).find((p) => p.seat === other.seat) : undefined;
  // The computer answers at once; nobody to wait for.
  if (!other || computerPlays(game, reactor?.id)) return null;
  const style = { "--side": reactor?.color } as CSSProperties;
  return (
    <div className="reroll-card may-react" role="status" style={style}>
      <strong>{t("{name} may react…", { name: other.name })}</strong>
      {held && hold > 0 && (
        <>
          <span key={opened} className="drain" style={{ animationDuration: `${hold}ms` }} />
          <button className="small quiet" onClick={releaseReactionHold}>
            {t("Go on")}
          </button>
        </>
      )}
    </div>
  );
}
