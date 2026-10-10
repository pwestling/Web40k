import type { Card, CardDeck, CardFace } from "../core/cards";
import { cleanText, type TtsObject } from "../figures/tts";

/**
 * A TTS save's card decks (#75): mission cards and the like. A TTS card is a
 * cell of a sprite sheet (CustomDeck: the face and back images, NumWidth ×
 * NumHeight cells) and its CardID is the sheet's number × 100 + the cell.
 * Decks are found anywhere, bags included; the same deck twice (one per
 * player, as mission packs lay them out) is one deck here, since each player
 * plays their own copy. Cards lying loose on the table make one deck.
 */

type Sheets = NonNullable<TtsObject["CustomDeck"]>;

const isDeck = (o: TtsObject) => o.Name === "Deck" || o.Name === "DeckCustom";
const isCard = (o: TtsObject) => o.Name === "Card" || o.Name === "CardCustom";

function faceOf(id: number, sheets: Sheets | undefined, back: boolean): CardFace | null {
  const sheet = sheets?.[String(Math.floor(id / 100))];
  const url = (back ? sheet?.BackURL : sheet?.FaceURL)?.trim();
  if (!sheet || !url) return null;
  const cols = Math.max(1, Math.floor(sheet.NumWidth ?? 1));
  const rows = Math.max(1, Math.floor(sheet.NumHeight ?? 1));
  // A shared back is the whole picture; a unique one is cut like the faces.
  if (back && !sheet.UniqueBack) return { url, cols: 1, rows: 1, index: 0 };
  return { url, cols, rows, index: Math.min(id % 100, cols * rows - 1) };
}

function cardOf(
  o: TtsObject,
  id: number,
  sheets: Sheets | undefined,
  fallback: string,
): Omit<Card, "id"> | null {
  const face = faceOf(id, o.CustomDeck ?? sheets, false);
  if (!face) return null;
  const back = faceOf(id, o.CustomDeck ?? sheets, true);
  return {
    name: cleanText(o.Nickname) || fallback,
    face,
    ...(back ? { back } : {}),
    ...(o.SidewaysCard ? { sideways: true } : {}),
  };
}

function deckOf(o: TtsObject): { name: string; cards: Omit<Card, "id">[] } {
  const name = cleanText(o.Nickname) || "Deck";
  const contained = (o.ContainedObjects ?? []).filter(isCard);
  const cards = contained.length
    ? contained.map((c, i) => cardOf(c, c.CardID ?? -1, o.CustomDeck, `${name} ${i + 1}`))
    : (o.DeckIDs ?? []).map((id, i) => cardOf({}, id, o.CustomDeck, `${name} ${i + 1}`));
  return { name, cards: cards.filter((c) => !!c) };
}

export function scanDecks(objects: TtsObject[]): CardDeck[] {
  const found: { name: string; cards: Omit<Card, "id">[] }[] = [];
  const loose: Omit<Card, "id">[] = [];
  const visit = (o: TtsObject, top: boolean) => {
    if (!o || typeof o !== "object") return;
    if (isDeck(o)) found.push(deckOf(o));
    else if (isCard(o)) {
      const c = cardOf(o, o.CardID ?? -1, undefined, `Card ${loose.length + 1}`);
      if (c && top) loose.push(c);
      else if (c) found.push({ name: c.name, cards: [c] });
    } else for (const c of o.ContainedObjects ?? []) visit(c, false);
  };
  for (const o of objects) visit(o, true);
  if (loose.length) found.push({ name: "Cards on the table", cards: loose });
  const seen = new Set<string>();
  const decks: CardDeck[] = [];
  for (const d of found) {
    if (!d.cards.length) continue;
    const sign = JSON.stringify(d.cards.map((c) => [c.face, c.name]));
    if (seen.has(sign)) continue;
    seen.add(sign);
    decks.push({
      id: `d${decks.length}`,
      name: d.name,
      cards: d.cards.map((c, i) => ({ ...c, id: `c${i}` })),
    });
  }
  return decks;
}
