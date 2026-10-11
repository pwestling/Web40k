import { useState, type CSSProperties } from "react";
import { undoneSeqs, type GameRecord, type GameState, type Intent, type PlayerId } from "../core";
import { playerActions, type PlayerActionOption } from "../core/content/player";
import { useRealDice } from "../companion/RealDice";
import { gameText, t } from "../i18n";
import { useCanControl, useStore } from "../store";
import { create } from "zustand";
import { useGame } from "./hooks";
import { coin, thunk } from "./sound";
import { useHandShown } from "./StratagemHand";

/**
 * The re-roll card by the dice (UX 84 #4, PX stratagem-hand.md "reactions"):
 * after a roll with dice that failed, the player who rolled them and could
 * still use a re-roll stratagem gets "Re-roll a 2? · 1 CP". Yes plays the
 * stratagem and re-rolls that one die (attack/reroll); the rest of the roll
 * stays. "Don't ask me this game" puts it away until the next game.
 */

/** Games (by their first event's time) where the player said not to ask. */
const useNotAsked = create<{ games: string[] }>(() => ({ games: [] }));
const gameKey = (record: GameRecord) => String(record.events[0]?.at ?? "");

/** A card with nothing to do of its own that re-rolls (Command Re-roll). */
const isReroll = (o: PlayerActionOption) =>
  o.ok &&
  !o.def.target &&
  !o.def.do?.length &&
  !o.def.procedure &&
  !o.def.move &&
  /re-?roll/i.test(`${o.def.id} ${o.def.name}`);

interface Offer {
  seq: number;
  roller: PlayerId;
  option: PlayerActionOption;
  sides: number;
  /** The first failed die of each face, to re-roll. */
  faces: { face: number; die: number }[];
}

function rerollOffer(
  game: GameState,
  record: GameRecord,
  canControl: (id: PlayerId) => boolean,
): Offer | null {
  const attack = game.attack;
  if (!attack?.run || attack.stage === "done") return null;
  // The roll in front of everyone: the attack's last event, if it was a roll.
  const undone = undoneSeqs(record);
  const last = record.events.findLast((e) => e.event.type.startsWith("attack/") && !undone.has(e.seq));
  if (last?.event.type !== "attack/roll") return null;
  const step = attack.run.records.findLast((r) => r.kind === "test" && r.dice?.length);
  if (!step?.dice || step.plan.kind !== "test") return null;
  const unit = step.id === "save" ? attack.spec.targetUnitId : attack.spec.attackerUnitId;
  const roller = game.units[unit]?.owner;
  if (!roller || !canControl(roller)) return null;
  const option = playerActions(game, roller).find(isReroll);
  if (!option) return null;
  const faces: Offer["faces"] = [];
  step.dice.forEach((d, die) => {
    if (d.success || d.rerolledFrom !== undefined || d.dice || d.followUp !== undefined) return;
    if (!faces.some((f) => f.face === d.value)) faces.push({ face: d.value, die });
  });
  if (!faces.length) return null;
  faces.sort((a, b) => a.face - b.face);
  return { seq: last.seq, roller, option, sides: step.plan.sides, faces };
}

export function RerollCard() {
  const game = useGame();
  const record = useStore((s) => s.record);
  const dispatch = useStore((s) => s.dispatch);
  const canControl = useCanControl();
  const shown = useHandShown();
  const ownDice = useRealDice();
  const notAsked = useNotAsked((s) => s.games.includes(gameKey(record)));
  const [passed, setPassed] = useState<number | null>(null);
  const [telling, setTelling] = useState<number | null>(null);
  const offer = shown && !notAsked ? rerollOffer(game, record, canControl) : null;
  if (!offer || passed === offer.seq) return null;
  const name = gameText(offer.option.def.name);

  const reroll = (die: number, told?: number) => {
    dispatch({ type: "player/action", action: offer.option.def.id }, offer.roller);
    const intent = { type: "attack/reroll", seq: offer.seq, die } as Intent;
    dispatch((told !== undefined ? { ...intent, told: [told] } : intent) as Intent, offer.roller);
    coin();
    thunk(1);
    setTelling(null);
  };
  const style = { "--side": game.players[offer.roller]?.color } as CSSProperties;

  return (
    <div className="reroll-card" role="group" aria-label={t("{name}?", { name })} style={style}>
      <span className="cost">{offer.option.cost}</span>
      <strong>{name}</strong>
      {telling === null ? (
        <>
          <div className="row">
            {offer.faces.map(({ face, die }) => (
              <button
                key={face}
                className="small primary"
                onClick={() => (ownDice ? setTelling(die) : reroll(die))}
              >
                {t("Re-roll a {face}", { face })}
              </button>
            ))}
            <button className="small" onClick={() => setPassed(offer.seq)}>
              {t("No")}
            </button>
          </div>
          <button
            className="link quiet"
            onClick={() => useNotAsked.setState((s) => ({ games: [...s.games, gameKey(record)] }))}
          >
            {t("Don't ask me this game")}
          </button>
        </>
      ) : (
        <>
          <span>{t("Roll one die. What did it show?")}</span>
          <div className="row">
            {Array.from({ length: offer.sides }, (_, i) => (
              <button key={i} className="small die-face" onClick={() => reroll(telling, i + 1)}>
                {i + 1}
              </button>
            ))}
            <button className="small quiet" onClick={() => setTelling(null)}>
              {t("Back")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
