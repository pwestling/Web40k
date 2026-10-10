import { useEffect, useState, type CSSProperties } from "react";
import {
  inHand,
  leftToDraw,
  nextCardKey,
  pileOf,
  type Card,
  type CardDeck,
  type CardFace,
} from "../core/cards";
import { t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import { keepSecret, localSecret, useLocalSecrets } from "../secrets/local";
import { useStore } from "../store";
import { useGame } from "./hooks";

/**
 * The table's card decks (#75, core/cards.ts): each player draws from their
 * own copy into a hand only their device can see, shows a card to play it,
 * discards, and shuffles their discards back. The pictures are the player's
 * own (a TTS save's card sheets); scoring stays with the players.
 */

/** Each sheet's cell shape (width ÷ height), once its picture has loaded. */
const aspects = new Map<string, number>();

function useAspect(face: CardFace, sideways?: boolean): number {
  const [, loaded] = useState(0);
  const key = `${face.url}|${face.cols}x${face.rows}`;
  useEffect(() => {
    if (aspects.has(key)) return;
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      aspects.set(key, img.naturalWidth / face.cols / (img.naturalHeight / face.rows));
      loaded((n) => n + 1);
    };
    img.src = face.url;
  }, [key, face.url, face.cols, face.rows]);
  return aspects.get(key) ?? (sideways ? 88 / 63 : 63 / 88);
}

function faceStyle(face: CardFace, aspect: number): CSSProperties {
  const col = face.index % face.cols;
  const row = Math.floor(face.index / face.cols);
  return {
    backgroundImage: `url("${face.url}")`,
    backgroundSize: `${face.cols * 100}% ${face.rows * 100}%`,
    backgroundPosition: `${face.cols > 1 ? (col / (face.cols - 1)) * 100 : 0}% ${face.rows > 1 ? (row / (face.rows - 1)) * 100 : 0}%`,
    aspectRatio: String(aspect),
  };
}

/** A card's picture, face or back; a click shows it large. */
function CardPicture({ card, back, onOpen }: { card: Card; back?: boolean; onOpen?: () => void }) {
  const face = back ? card.back : card.face;
  const aspect = useAspect(card.face, card.sideways);
  if (!face) return <span className="card-pic blank" style={{ aspectRatio: String(aspect) }} />;
  return (
    <button
      className="card-pic"
      style={faceStyle(face, aspect)}
      title={back ? t("Face down") : card.name}
      aria-label={back ? t("Face down") : card.name}
      onClick={onOpen}
    />
  );
}

export function CardDecks({ players }: { players: { id: string; name: string; color: string }[] }) {
  const game = useGame();
  useLocalSecrets((s) => s.kept);
  const [big, setBig] = useState<Card | null>(null);
  if (!game.decks?.length) return null;
  return (
    <details className="fold card-decks">
      <summary>{t("Cards")}</summary>
      {game.decks.map((deck) => (
        <DeckRow key={deck.id} deck={deck} players={players} onOpen={setBig} />
      ))}
      {big && (
        <div className="modal-backdrop" onClick={() => setBig(null)}>
          <div className="card-big" role="dialog" aria-label={big.name}>
            <CardPicture card={big} />
            <p>{big.name}</p>
          </div>
        </div>
      )}
    </details>
  );
}

function DeckRow({
  deck,
  players,
  onOpen,
}: {
  deck: CardDeck;
  players: { id: string }[];
  onOpen: (card: Card) => void;
}) {
  const game = useGame();
  const { dispatch } = useStore();
  const live = useStore((s) => s.scrub === null);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  const cardOf = (id: unknown) => deck.cards.find((c) => c.id === String(id));
  return (
    <div className="deck">
      <div className="row spread">
        <strong>{deck.name}</strong>
        <span className="muted small">{tn(deck.cards.length, "{n} card", "{n} cards")}</span>
        {live && players.length > 0 && (
          <button
            className="quiet small"
            title={t("Put this deck away, for everyone")}
            onClick={() => {
              if (confirm(t("Put {deck} away for everyone?", { deck: deck.name })))
                dispatch({ type: "deck/remove", id: deck.id });
            }}
          >
            ✕
          </button>
        )}
      </div>
      {seated.map((p) => {
        const mine = players.some((m) => m.id === p.id);
        const hand = inHand(game, p.id, deck.id);
        const pile = pileOf(game, p.id, deck.id);
        const left = leftToDraw(game, p.id, deck, (e) => {
          const v = localSecret(e.commitment)?.value;
          return v === undefined ? undefined : String(v);
        });
        const hidden = hand.filter(([, e]) => !e.revealed).length;
        const draw = () => {
          // Drawn here at random from what's left; only the commitment goes to the table.
          const card = left[crypto.getRandomValues(new Uint32Array(1))[0]! % left.length]!;
          dispatch(
            {
              type: "secret/commit",
              player: p.id,
              secrets: [{ key: nextCardKey(game, p.id, deck.id), commitment: keepSecret(card.id) }],
              label: deck.name,
            },
            p.id,
          );
        };
        const show = (key: string) => {
          const k = localSecret(game.secrets![p.id]![key]!.commitment);
          if (k)
            dispatch(
              { type: "secret/reveal", player: p.id, key, value: k.value, salt: k.salt, label: deck.name },
              p.id,
            );
        };
        const lastDiscard = pile.discarded.at(-1);
        const top = lastDiscard ? game.secrets?.[p.id]?.[lastDiscard]?.revealed : undefined;
        if (!mine && !hand.length && !pile.discarded.length) return null;
        return (
          <div key={p.id} className="deck-player">
            <span style={{ color: p.color }}>{displayName(p.name)}</span>{" "}
            <span className="muted small">
              {mine
                ? tn(left.length, "{n} left to draw", "{n} left to draw")
                : tn(hidden, "{n} face down", "{n} face down")}
              {pile.discarded.length > 0 &&
                ` · ${tn(pile.discarded.length, "{n} discarded", "{n} discarded")}`}
            </span>
            <ul className="hand">
              {hand.map(([key, e]) => {
                const id = e.revealed
                  ? e.revealed.value
                  : mine
                    ? localSecret(e.commitment)?.value
                    : undefined;
                const card = cardOf(id);
                if (!e.revealed && !mine) return null;
                return (
                  <li key={key} className={e.revealed ? "shown" : ""}>
                    {card ? (
                      <CardPicture card={card} onOpen={() => onOpen(card)} />
                    ) : (
                      <span className="muted small">{t("(drawn on another device)")}</span>
                    )}
                    {card && <span className="small">{card.name}</span>}
                    {mine && live && (
                      <span className="row">
                        {!e.revealed && card && (
                          <button className="small" onClick={() => show(key)}>
                            {t("Show")}
                          </button>
                        )}
                        <button
                          className="small quiet"
                          onClick={() => dispatch({ type: "deck/discard", deck: deck.id, key }, p.id)}
                        >
                          {t("Discard")}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {top && cardOf(top.value) && (
              <p className="muted small">{t("Last discarded: {card}", { card: cardOf(top.value)!.name })}</p>
            )}
            {mine && live && (
              <div className="row">
                <button disabled={!left.length} onClick={draw}>
                  {t("Draw a card")}
                </button>
                {pile.discarded.length > 0 && (
                  <button
                    className="quiet"
                    onClick={() => dispatch({ type: "deck/shuffle", deck: deck.id }, p.id)}
                  >
                    {t("Shuffle discards back")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
