import { currentSlot } from "../../core/content/turn";
import { act, charge, moveWith, positionOf, scene, toward } from "./build";
import type { BenchItem, BenchSet } from "./judge";

/**
 * 40k (forty-k-11) with the invented sample armies: the Vanguard Legion (the
 * side deciding, seat 0) against the Ashen Host. Plays any player would
 * agree on; where reasonable players could differ, the pair is left out.
 */
const SYSTEM = "forty-k-11";
const RIFLE = "pattern-rifle-ranged";
const LANCE = "arc-lance-ranged";
const BOLTER = "twin-autobolter-ranged";

/** Seat 0's own turn, round 2, at the start of the phase named, laid out by `lay`. */
const table = (phase: string, lay: Parameters<typeof scene>[3]) =>
  scene(
    SYSTEM,
    phase,
    (s) => s.turn.round === 2 && s.turn.activeSeat === 0 && currentSlot(s)?.id === phase,
    lay,
  );

const item = (id: string, why: string, build: BenchItem["build"]): BenchItem => ({ id, why, build });

export const fortyKBench: BenchSet = {
  system: SYSTEM,
  items: [
    item(
      "shoot-what-you-can-wound",
      "Rifles at infantry they wound, not a tank they barely scratch",
      async () => {
        const { t, record, id } = await table("shooting", (t, id) => {
          t.only(id("Line Troopers"), id("Ashen Thralls"), id("Slag Crawler"));
          t.place(id("Line Troopers"), 0, 9)
            .place(id("Ashen Thralls"), -7, -4)
            .place(id("Slag Crawler"), 7, -4);
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: act(s, id("Line Troopers"), "shoot", id("Ashen Thralls"), RIFLE),
          worse: act(s, id("Line Troopers"), "shoot", id("Slag Crawler"), RIFLE),
        };
      },
    ),
    item("finish-the-monster", "The lance at a monster on 2 wounds, not a fresh tank", async () => {
      const { t, record, id } = await table("shooting", (t, id) => {
        t.only(id("Lance Team"), id("Cinder Colossus"), id("Slag Crawler"));
        t.place(id("Lance Team"), 0, 10)
          .place(id("Cinder Colossus"), -8, -6)
          .place(id("Slag Crawler"), 8, -6);
        t.hurt(id("Cinder Colossus"), 1, 2);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Lance Team"), "shoot", id("Cinder Colossus"), LANCE),
        worse: act(s, id("Lance Team"), "shoot", id("Slag Crawler"), LANCE),
      };
    }),
    item(
      "monster-over-character",
      "Finish a 2-wound monster before starting on a fresh character",
      async () => {
        const { t, record, id } = await table("shooting", (t, id) => {
          t.only(id("Bastion Walker"), id("Cinder Colossus"), id("Pyre Speaker"));
          t.place(id("Bastion Walker"), 0, 10)
            .place(id("Cinder Colossus"), -8, -6)
            .place(id("Pyre Speaker"), 8, -6);
          t.hurt(id("Cinder Colossus"), 1, 2);
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: act(s, id("Bastion Walker"), "shoot", id("Cinder Colossus"), BOLTER),
          worse: act(s, id("Bastion Walker"), "shoot", id("Pyre Speaker"), BOLTER),
        };
      },
    ),
    item("finish-the-squad", "Rifles on the last two Brutes, not a fresh tank they can't hurt", async () => {
      const { t, record, id } = await table("shooting", (t, id) => {
        t.only(id("Line Troopers"), id("Cinder Brutes"), id("Slag Crawler"), id("Pyre Speaker"));
        t.place(id("Line Troopers"), 0, 5)
          .place(id("Cinder Brutes"), -5, -2)
          .place(id("Slag Crawler"), 7, -3);
        t.place(id("Pyre Speaker"), 0, -14);
        t.hurt(id("Cinder Brutes"), 2, 1);
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Line Troopers"), "shoot", id("Cinder Brutes"), RIFLE),
        worse: act(s, id("Line Troopers"), "shoot", id("Slag Crawler"), RIFLE),
      };
    }),
    item("take-the-objective", "Onto an empty objective, not away from it", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Line Troopers"), id("Slag Crawler"));
        t.place(id("Line Troopers"), -20, 6).place(id("Slag Crawler"), 20, -16);
      });
      const s = t.s;
      const u = id("Line Troopers");
      return {
        p: positionOf(record, s, 0),
        better: moveWith(s, u, "normalMove", toward(s, u, -20, 0, 5.5)),
        worse: moveWith(s, u, "normalMove", toward(s, u, -20, 12, 5.5)),
      };
    }),
    item("hold-the-objective", "Stay on the objective, not walk off it for nothing", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Line Troopers"), id("Ashen Thralls"));
        t.place(id("Line Troopers"), -20, 0).place(id("Ashen Thralls"), -20, -15);
      });
      const s = t.s;
      const u = id("Line Troopers");
      return {
        p: positionOf(record, s, 0),
        better: act(s, u, "remainStationary"),
        worse: moveWith(s, u, "normalMove", toward(s, u, -28, 10, 5.5)),
      };
    }),
    item("stay-in-cover", "Heavy guns stay in their ruin, not walk into the open for nothing", async () => {
      const { t, record, src, id } = await table("movement", (t, id) => {
        t.only(id("Lance Team"), id("Slag Crawler"), id("Cinder Colossus"));
        t.place(id("Lance Team"), 10, 10)
          .place(id("Slag Crawler"), 4, -14)
          .place(id("Cinder Colossus"), 16, -12);
        // Nothing to gain by going anywhere (its home objective is a walk away).
        t.noObjectives();
      });
      t.terrain(src, 10, 10, /ruin/i);
      const s = t.s;
      const u = id("Lance Team");
      return {
        p: positionOf(record, s, 0),
        better: act(s, u, "remainStationary"),
        worse: moveWith(s, u, "normalMove", toward(s, u, 10, -14, 4.5)),
      };
    }),
    item("keep-the-heavy-bonus", "Heavy guns already in range stay put, not shuffle sideways", async () => {
      const { t, record, id } = await table("movement", (t, id) => {
        t.only(id("Lance Team"), id("Slag Crawler"), id("Cinder Colossus"));
        t.place(id("Lance Team"), 10, 12)
          .place(id("Slag Crawler"), 4, -16)
          .place(id("Cinder Colossus"), 16, -16);
        t.noObjectives();
      });
      const s = t.s;
      const u = id("Lance Team");
      return {
        p: positionOf(record, s, 0),
        better: act(s, u, "remainStationary"),
        worse: moveWith(s, u, "normalMove", toward(s, u, 14, 12, 4)),
      };
    }),
    item(
      "fight-the-character",
      "The Marshal's blade finishes the wounded Pyre Speaker, not fresh Thralls",
      async () => {
        const { t, record, id } = await table("fight", (t, id) => {
          t.only(id("Field Marshal"), id("Pyre Speaker"), id("Ashen Thralls"));
          t.place(id("Field Marshal"), -10, 7)
            .place(id("Pyre Speaker"), -8.4, 7)
            .place(id("Ashen Thralls"), -15.5, 6);
          t.hurt(id("Pyre Speaker"), 1, 1);
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: act(s, id("Field Marshal"), "fight", id("Pyre Speaker"), "duty-blade-melee"),
          worse: act(s, id("Field Marshal"), "fight", id("Ashen Thralls"), "duty-blade-melee"),
        };
      },
    ),
    item("charge-what-you-can-beat", "Charge the last two Thralls, not a fresh Colossus", async () => {
      const { t, record, id } = await table("charge", (t, id) => {
        t.only(id("Field Marshal"), id("Ashen Thralls"), id("Cinder Colossus"));
        t.place(id("Field Marshal"), 0, 4)
          .place(id("Ashen Thralls"), -5, 0)
          .place(id("Cinder Colossus"), 5, -1);
        t.hurt(id("Ashen Thralls"), 2);
      });
      const s = t.s;
      const u = id("Field Marshal");
      return {
        p: positionOf(record, s, 0),
        better: charge(s, u, "charge", id("Ashen Thralls")),
        worse: charge(s, u, "charge", id("Cinder Colossus")),
      };
    }),
    item("charge-the-remnant", "Troopers charge the last two Thralls, not fresh Cinder Brutes", async () => {
      const { t, record, id } = await table("charge", (t, id) => {
        t.only(id("Line Troopers"), id("Ashen Thralls"), id("Cinder Brutes"));
        t.place(id("Line Troopers"), 0, 6).place(id("Ashen Thralls"), -6, 0).place(id("Cinder Brutes"), 6, 0);
        t.hurt(id("Ashen Thralls"), 2);
      });
      const s = t.s;
      const u = id("Line Troopers");
      return {
        p: positionOf(record, s, 0),
        better: charge(s, u, "charge", id("Ashen Thralls")),
        worse: charge(s, u, "charge", id("Cinder Brutes")),
      };
    }),
  ],
};
