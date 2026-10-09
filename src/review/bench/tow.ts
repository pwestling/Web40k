import { currentSlot } from "../../core/content/turn";
import { act, chargeMove, positionOf, scene, shift } from "./build";
import type { BenchItem, BenchSet } from "./judge";
import type { BotMove } from "../../soak/bot";
import type { GameState } from "../../core";

/**
 * The Old World (tow-hand) with the invented sample armies: the Marchwarden
 * Host (seat 0, deciding) against the Reavers. No objectives: the sample
 * mission scores what the enemy lost.
 */
const SYSTEM = "tow-hand";

const table = (phase: string, lay: Parameters<typeof scene>[3]) =>
  scene(
    SYSTEM,
    phase,
    (s) => s.turn.round === 2 && s.turn.activeSeat === 0 && currentSlot(s)?.id === phase,
    lay,
  );

const item = (id: string, why: string, build: BenchItem["build"]): BenchItem => ({ id, why, build });

/** A declared charge (the game's code action) and the move into contact. */
function towCharge(s: GameState, unit: string, target: string): BotMove {
  const u = s.units[unit]!;
  return {
    intent: { type: "script/start", procedure: "chargeReaction", args: { unit, target } },
    as: u.owner,
    kind: "bench",
    then: chargeMove(s, u, { rng: () => 0.5, kept: new Map(), idle: 0 }, 24, target),
  };
}

export const towBench: BenchSet = {
  system: SYSTEM,
  items: [
    item("finish-the-runners", "Bows on the last Wolf Runner, not fresh Tusk Brutes", async () => {
      const { t, record, id } = await table("shooting", (t, id) => {
        t.only(id("Fen Bowmen"), id("Wolf Runners"), id("Tusk Brutes"));
        t.place(id("Fen Bowmen"), 0, 10).place(id("Wolf Runners"), -7, -4).place(id("Tusk Brutes"), 7, -4);
        t.hurt(id("Wolf Runners"), 1);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Fen Bowmen"), "shoot", id("Wolf Runners"), "missile"),
        worse: act(s, id("Fen Bowmen"), "shoot", id("Tusk Brutes"), "missile"),
      };
    }),
    item("charge-the-weak", "Riders charge the Slingers, not the Tusk Brutes", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Riders of the Downs"), id("Reaver Slingers"), id("Tusk Brutes"));
        t.place(id("Riders of the Downs"), 0, 7)
          .place(id("Reaver Slingers"), -6, -2)
          .place(id("Tusk Brutes"), 6, -2);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: towCharge(s, id("Riders of the Downs"), id("Reaver Slingers")),
        worse: towCharge(s, id("Riders of the Downs"), id("Tusk Brutes")),
      };
    }),
    item("finish-the-hulk", "Bows on the Bog Hulk's last wound, not the Warband's thirty", async () => {
      const { t, record, id } = await table("shooting", (t, id) => {
        t.only(id("Fen Bowmen"), id("Bog Hulk"), id("Reaver Warband"));
        t.place(id("Fen Bowmen"), 0, 10).place(id("Bog Hulk"), -8, -4).place(id("Reaver Warband"), 8, -6);
        t.hurt(id("Bog Hulk"), 1, 1);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Fen Bowmen"), "shoot", id("Bog Hulk"), "missile"),
        worse: act(s, id("Fen Bowmen"), "shoot", id("Reaver Warband"), "missile"),
      };
    }),
    item("bows-dont-charge-brutes", "Bowmen step back rather than charge the Tusk Brutes", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Fen Bowmen"), id("Tusk Brutes"));
        t.place(id("Fen Bowmen"), 0, 5).place(id("Tusk Brutes"), 0, -5);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: shift(s, id("Fen Bowmen"), 0, 4),
        worse: towCharge(s, id("Fen Bowmen"), id("Tusk Brutes")),
      };
    }),
    item("keep-the-bows-back", "Bowmen step back from the Tusk Brutes, not into their charge", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Fen Bowmen"), id("Tusk Brutes"));
        t.place(id("Fen Bowmen"), 0, 8).place(id("Tusk Brutes"), 0, -8);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: shift(s, id("Fen Bowmen"), 0, 4),
        worse: shift(s, id("Fen Bowmen"), 0, -4),
      };
    }),
    item("spears-charge-the-slingers", "Spears charge the Slingers, not the Tusk Brutes", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Marchwarden Spears"), id("Reaver Slingers"), id("Tusk Brutes"));
        t.place(id("Marchwarden Spears"), 0, 6)
          .place(id("Reaver Slingers"), -7, 0)
          .place(id("Tusk Brutes"), 7, 0);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: towCharge(s, id("Marchwarden Spears"), id("Reaver Slingers")),
        worse: towCharge(s, id("Marchwarden Spears"), id("Tusk Brutes")),
      };
    }),
  ],
};
