import { undoneSeqs, type GameRecord, type GameState, type Intent } from "../core";
import { campaignHooks, type CampaignAward } from "../core/script";
import { gameStats } from "../core/stats";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import type { CampaignStory } from "../sdk";
import { campaignUnitKey, type CampaignBook, type CampaignUnit } from "./book";

/**
 * Campaign rules as code (roadmap 24b). A game module or rules package can
 * hook a campaign game twice (sdk TurnHooks `beforeGame` and `afterGame`).
 * The book starts the hooks as ordinary code procedures, so their rolls are
 * in the log for everyone. What `afterGame` awards (`campaign/award` events)
 * goes into each unit's story when the book records the game (book.ts).
 * Everything here is worked out from the game alone, so every peer's book
 * comes out the same.
 */

/** The campaign units on the table, as the hooks see them; with this game's numbers once it's over. */
export function campaignStories(
  book: CampaignBook,
  record: GameRecord,
  game: GameState,
  over: boolean,
): CampaignStory[] {
  const stats = over ? new Map(gameStats(record).units.map((u) => [u.id, u])) : null;
  const out: CampaignStory[] = [];
  for (const unit of Object.values(game.units)) {
    const key = campaignUnitKey(game, unit.id);
    if (!key) continue;
    const was: Partial<CampaignUnit> = book.units[key] ?? {};
    out.push({
      key,
      unitId: unit.id,
      name: unit.name,
      owner: unit.owner,
      games: was.games ?? 0,
      kills: was.kills ?? 0,
      xp: was.xp ?? 0,
      honours: was.honours ?? "",
      scars: was.scars ?? "",
      ...(stats
        ? {
            slain: stats.get(unit.id)?.slain ?? 0,
            survived: unit.modelIds.some((m) => game.models[m] && !game.models[m]!.destroyed),
          }
        : {}),
    });
  }
  return out;
}

/** The procedures that have been started in this game (and not taken back). */
function started(record: GameRecord): Set<string> {
  const undone = undoneSeqs(record);
  const ids = new Set<string>();
  for (const l of record.events)
    if (!undone.has(l.seq) && l.event.type === "script/step" && l.event.started) ids.add(l.event.started);
  return ids;
}

/**
 * The next campaign hook of this kind to start, as an intent, or null when
 * they've all run (or one is running now, or the game has none).
 */
export function nextCampaignHook(
  kind: "beforeGame" | "afterGame",
  book: CampaignBook,
  record: GameRecord,
  game: GameState,
): Intent | null {
  if (game.script) return null;
  const ids = campaignHooks(game.system ?? DEFAULT_SYSTEM)[kind];
  const done = started(record);
  const next = ids.find((id) => !done.has(id));
  if (!next) return null;
  return {
    type: "script/start",
    procedure: next,
    args: { units: campaignStories(book, record, game, kind === "afterGame") },
  };
}

/** Whether the game's after-game campaign rules have all run (or it has none). */
export function afterGameDone(record: GameRecord, game: GameState): boolean {
  if (game.script) return false;
  const done = started(record);
  return campaignHooks(game.system ?? DEFAULT_SYSTEM).afterGame.every((id) => done.has(id));
}

/** Every award the campaign rules gave in this game, in order. */
export function awardsIn(record: GameRecord): CampaignAward[] {
  const undone = undoneSeqs(record);
  const out: CampaignAward[] = [];
  for (const l of record.events) {
    if (undone.has(l.seq)) continue;
    const e = l.event;
    if (e.type === "campaign/award") out.push(e);
    else if (e.type === "script/step") for (const x of e.events) if (x.type === "campaign/award") out.push(x);
  }
  return out;
}

const add = (list: string, item: string) => (list.trim() ? `${list.trim()}; ${item}` : item);

/** The units' stories with this game's awards added. */
export function applyAwards(
  units: Record<string, CampaignUnit>,
  awards: CampaignAward[],
): Record<string, CampaignUnit> {
  const out = { ...units };
  for (const a of awards) {
    const u = out[a.key];
    if (!u) continue;
    out[a.key] = {
      ...u,
      ...(a.xp ? { xp: Math.max(0, (u.xp ?? 0) + a.xp) } : {}),
      ...(a.honour ? { honours: add(u.honours, a.honour) } : {}),
      ...(a.scar ? { scars: add(u.scars, a.scar) } : {}),
    };
  }
  return out;
}
