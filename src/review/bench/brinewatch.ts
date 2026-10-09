import brinewatch from "../../../games/brinewatch/brinewatch.js?raw";
import { currentSlot } from "../../core/content/turn";
import { actingUnits } from "../../core/content/play";
import { goal, positionOf, scene } from "./build";
import type { BenchItem, BenchSet } from "./judge";
import type { BotMove } from "../../soak/bot";
import type { GameState } from "../../core";

/**
 * Brinewatch (#69, a whole game from a package) with its sample crews: the
 * Tollkeepers (seat 0) against the Gullrunners. The model deciding is put at
 * the start of its go, with both action points.
 */
const SYSTEM = "brinewatch";

const table = (lay: Parameters<typeof scene>[3], terrain = false) =>
  scene(
    SYSTEM,
    "go",
    (s) =>
      s.turn.round === 2 &&
      s.turn.activeSeat === 0 &&
      currentSlot(s)?.kind === "alternate" &&
      !actingUnits(s).length,
    (t, id) => {
      // No moves remembered from earlier in the round: each go here starts where its model stands.
      const own = { ...t.s.modules?.[SYSTEM] };
      for (const k of Object.keys(own)) if (k.startsWith("path:")) delete own[k];
      t.s = { ...t.s, modules: { ...t.s.modules, [SYSTEM]: own } };
      lay(t, id);
    },
    { systemPkg: { source: brinewatch }, terrain },
  );

const item = (id: string, why: string, build: BenchItem["build"]): BenchItem => ({ id, why, build });

/** A code action (shoot, fight) at a target, as the computer offers one. */
function code(s: GameState, unit: string, procedure: string, target: string): BotMove {
  return {
    intent: { type: "script/start", procedure, args: { unit, target } },
    as: s.units[unit]!.owner,
    kind: `code:${procedure}`,
  };
}

export const brinewatchBench: BenchSet = {
  system: SYSTEM,
  items: [
    item(
      "finish-the-wounded-hookshot",
      "Ness shoots the Hookshot down to a wound, not the fresh one beside it: both can shoot back",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Ness"), id("Sable"), id("Lugg")).noObjectives();
          t.place(id("Ness"), 0, 9).place(id("Sable"), -4, -3).place(id("Lugg"), 4, -3);
          t.hurt(id("Sable"), 1, 1);
          t.activate(id("Ness"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: code(s, id("Ness"), "shoot", id("Sable")),
          worse: code(s, id("Ness"), "shoot", id("Lugg")),
        };
      },
    ),
    item(
      "finish-the-boss",
      "Captain Orrin shoots Mother Skerry, down to a wound, not a fresh Cutter",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Captain Orrin"), id("Mother Skerry"), id("Dace")).noObjectives();
          t.place(id("Captain Orrin"), 0, 9).place(id("Mother Skerry"), -3, -5).place(id("Dace"), 3, -5);
          t.hurt(id("Mother Skerry"), 1, 1);
          t.activate(id("Captain Orrin"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: code(s, id("Captain Orrin"), "shoot", id("Mother Skerry")),
          worse: code(s, id("Captain Orrin"), "shoot", id("Dace")),
        };
      },
    ),
    item(
      "fight-the-wounded",
      "Brack fights the Cutter with a wound left, not the fresh one beside it",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Brack"), id("Fin"), id("Wick")).noObjectives();
          t.place(id("Brack"), 0, 0).place(id("Fin"), -1.4, 0).place(id("Wick"), 1.4, 0);
          t.hurt(id("Fin"), 1, 1);
          t.activate(id("Brack"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: code(s, id("Brack"), "fight", id("Fin")),
          worse: code(s, id("Brack"), "fight", id("Wick")),
        };
      },
    ),
    item(
      "shoot-the-hookshot",
      "Harl shoots the Hookshot down to a wound, not the Cutter far off",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Harl"), id("Sable"), id("Rook")).noObjectives();
          t.place(id("Harl"), 0, 9).place(id("Sable"), -5, -2).place(id("Rook"), 6, -9);
          t.hurt(id("Sable"), 1, 1);
          t.activate(id("Harl"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: code(s, id("Harl"), "shoot", id("Sable")),
          worse: code(s, id("Harl"), "shoot", id("Rook")),
        };
      },
    ),
    item(
      "shoot-the-gunner",
      "Harl shoots the Hookshot that can shoot back, not a Cutter out of reach",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Harl"), id("Lugg"), id("Wick")).noObjectives();
          t.place(id("Harl"), 0, 9).place(id("Lugg"), -5, -4).place(id("Wick"), 8, -9);
          t.activate(id("Harl"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: code(s, id("Harl"), "shoot", id("Lugg")),
          worse: code(s, id("Harl"), "shoot", id("Wick")),
        };
      },
    ),
    item("back-from-the-cutters", "Ness steps back from two Cutters, not into their reach", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Ness"), id("Fin"), id("Wick")).noObjectives();
        t.place(id("Ness"), 0, 3).place(id("Fin"), -1, -6).place(id("Wick"), 1, -6);
        t.activate(id("Ness"));
      });
      const s = t.s;
      const u = id("Ness");
      return {
        p: positionOf(record, s, 0),
        better: goal(s, u, 5, 0, 10),
        worse: goal(s, u, 5, 0, -6),
      };
    }),
    item("take-the-cache", "Brack walks onto the empty west cache, not away from it", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Brack"), id("Rook"));
        t.place(id("Brack"), -10, 5).place(id("Rook"), 12, -9);
        t.activate(id("Brack"));
      });
      const s = t.s;
      const u = id("Brack");
      return {
        p: positionOf(record, s, 0),
        better: goal(s, u, 6, -10, 0),
        worse: goal(s, u, 6, -10, 11),
      };
    }),
    item(
      "hold-the-middle",
      "Tamsin walks onto the middle cache a Cutter is coming for, not to the edge",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Tamsin"), id("Dace"));
          t.place(id("Tamsin"), 0, 5).place(id("Dace"), 0, -9);
          t.activate(id("Tamsin"));
        });
        const s = t.s;
        const u = id("Tamsin");
        return {
          p: positionOf(record, s, 0),
          better: goal(s, u, 6, 0, 0.5),
          worse: goal(s, u, 6, 6, 11),
        };
      },
    ),
  ],
};
