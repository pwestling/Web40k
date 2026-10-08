import type { GameState, Unit } from "../../core";
import { destroyed, edgeZones, enemyUnits, plural } from "../../missions/common";
import type { Mission } from "../../sdk";

/**
 * An invented sample mission for the Old World, written for Open Battle.
 * Victory points come from what the enemy lost: units destroyed, units still
 * fleeing at the end, standards taken and the general slain.
 */

const points = (u: Unit) => u.sheet?.points ?? 0;
const STANDARD = /\b(standard|banner)\b/i;
const isGeneral = (u: Unit) =>
  /general/i.test(u.name) || (u.sheet?.keywords ?? []).some((k) => /general/i.test(k)) || !!u.status?.general;
const hasStandard = (game: GameState, u: Unit) =>
  u.modelIds.some((id) => STANDARD.test(game.models[id]?.profile?.name ?? game.models[id]?.label ?? ""));

export const fieldOfGlory: Mission = {
  id: "field-of-glory",
  name: "Field of Glory (sample)",
  summary:
    "A pitched battle. At the end, score each enemy unit destroyed (its points), half for one still fleeing, 50 for each standard taken and 100 for their general.",
  setup: (t) => ({ zones: edgeZones(t, 12), objectives: [] }),
  scoring: [
    {
      id: "victory",
      name: "Field of Glory",
      at: { gameEnd: true },
      suggest: (game, seat) => {
        let vp = 0;
        const parts: string[] = [];
        const enemies = enemyUnits(game, seat);
        const dead = enemies.filter((u) => destroyed(game, u));
        const fled = enemies.filter((u) => !destroyed(game, u) && u.status?.fleeing);
        const dp = dead.reduce((n, u) => n + points(u), 0);
        const fp = fled.reduce((n, u) => n + Math.floor(points(u) / 2), 0);
        if (dead.length) parts.push(`${plural(dead.length, "unit")} destroyed (${dp})`);
        if (fled.length) parts.push(`${plural(fled.length, "unit")} fleeing (${fp})`);
        vp += dp + fp;
        const standards = dead.filter((u) => hasStandard(game, u)).length;
        if (standards) {
          vp += 50 * standards;
          parts.push(`${plural(standards, "standard")} taken (${50 * standards})`);
        }
        if (dead.some(isGeneral)) {
          vp += 100;
          parts.push("their general slain (100)");
        }
        return { vp, why: parts.join(", ") || "the enemy lost nothing" };
      },
    },
  ],
};

export const TOW_MISSIONS: Mission[] = [fieldOfGlory];
