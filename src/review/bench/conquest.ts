import { currentSlot } from "../../core/content/turn";
import { actingUnits } from "../../core/content/play";
import { act, goal, moveWith, positionOf, scene } from "./build";
import type { BenchItem, BenchSet } from "./judge";
import type { BotMove } from "../../soak/bot";
import type { GameState } from "../../core";

/**
 * Conquest (conquest-hand) with the invented sample armies: seat 0's
 * regiments against the Thrall Host's. The unit deciding is put mid-activation.
 */
const SYSTEM = "conquest-hand";

const table = (lay: Parameters<typeof scene>[3]) =>
  scene(
    SYSTEM,
    "activation",
    (s) =>
      s.turn.round === 2 &&
      s.turn.activeSeat === 0 &&
      currentSlot(s)?.kind === "alternate" &&
      !actingUnits(s).length,
    (t, id) => {
      // No command stack: whichever regiment the enemy likes best answers.
      t.noSecrets();
      lay(t, id);
    },
    { keep: /reserve/ },
  );

const item = (id: string, why: string, build: BenchItem["build"]): BenchItem => ({ id, why, build });

/** A charge as the computer declares one here: rolled by hand, the move to follow if it reaches. */
function rolledCharge(s: GameState, unit: string, target: string): BotMove {
  const u = s.units[unit]!;
  return {
    ...act(s, unit, "charge", target),
    then: {
      intent: { type: "dice/roll", count: 1, sides: 6, label: "charge", unitId: unit, targets: [target] },
      as: u.owner,
      kind: "roll",
    },
  };
}

export const conquestBench: BenchSet = {
  system: SYSTEM,
  items: [
    item("finish-the-archers", "Crossbows on the last Bone Archer stand, not fresh Thralls", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Ironmarch Crossbows"), id("Bone Archers"), id("Thrall Host"));
        t.place(id("Ironmarch Crossbows"), 0, 10)
          .place(id("Bone Archers"), -6, -4)
          .place(id("Thrall Host"), 6, -4);
        t.hurt(id("Bone Archers"), 1, 1);
        t.activate(id("Ironmarch Crossbows"));
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Ironmarch Crossbows"), "volley", id("Bone Archers")),
        worse: act(s, id("Ironmarch Crossbows"), "volley", id("Thrall Host")),
      };
    }),
    item(
      "finish-the-thralls",
      "Crossbows on the last wounded Thrall stand, not the Ossuary Colossus",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Ironmarch Crossbows"), id("Thrall Host"), id("Ossuary Colossus")).noObjectives();
          // Beyond either's march and charge: nothing comes back at the crossbows this round.
          t.place(id("Ironmarch Crossbows"), 0, 13)
            .place(id("Thrall Host"), -6, -8)
            .place(id("Ossuary Colossus"), 6, -8);
          t.hurt(id("Thrall Host"), 1, 1);
          t.activate(id("Ironmarch Crossbows"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: act(s, id("Ironmarch Crossbows"), "volley", id("Thrall Host")),
          worse: act(s, id("Ironmarch Crossbows"), "volley", id("Ossuary Colossus")),
        };
      },
    ),
    item("charge-the-archers", "Riders charge the archers, not the Ossuary Colossus", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Iron Riders"), id("Bone Archers"), id("Ossuary Colossus"));
        t.place(id("Iron Riders"), 0, 11)
          .place(id("Bone Archers"), -5, 2)
          .place(id("Ossuary Colossus"), 5.5, 1);
        t.activate(id("Iron Riders"));
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: rolledCharge(s, id("Iron Riders"), id("Bone Archers")),
        worse: rolledCharge(s, id("Iron Riders"), id("Ossuary Colossus")),
      };
    }),
    item("keep-crossbows-back", "Crossbows march back from the Colossus, not into its charge", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Ironmarch Crossbows"), id("Ossuary Colossus")).noObjectives();
        t.place(id("Ironmarch Crossbows"), 30, 8).place(id("Ossuary Colossus"), 30, -8);
        t.activate(id("Ironmarch Crossbows"));
      });
      const s = t.s;
      const u = id("Ironmarch Crossbows");
      return {
        p: positionOf(record, s, 0),
        better: moveWith(s, u, "march", goal(s, u, 5, 30, 20)),
        worse: moveWith(s, u, "march", goal(s, u, 5, 30, -8)),
      };
    }),
    item("take-the-objective", "March onto the empty objective, not away from it", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Shieldwall Spears"), id("Thrall Host"));
        t.place(id("Shieldwall Spears"), -18, 5).place(id("Thrall Host"), 18, -14);
        t.activate(id("Shieldwall Spears"));
      });
      const s = t.s;
      const u = id("Shieldwall Spears");
      return {
        p: positionOf(record, s, 0),
        better: moveWith(s, u, "march", goal(s, u, 5, -18, 0)),
        worse: moveWith(s, u, "march", goal(s, u, 5, -18, 0, true)),
      };
    }),
    item(
      "charge-what-you-can-reach",
      'Spears charge the archers 4" away, not Thralls beyond any roll',
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Shieldwall Spears"), id("Bone Archers"), id("Thrall Host"));
          t.place(id("Shieldwall Spears"), 0, 13)
            .place(id("Bone Archers"), -2, 6)
            .place(id("Thrall Host"), 2, -6);
          t.activate(id("Shieldwall Spears"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: rolledCharge(s, id("Shieldwall Spears"), id("Bone Archers")),
          worse: rolledCharge(s, id("Shieldwall Spears"), id("Thrall Host")),
        };
      },
    ),
  ],
};
