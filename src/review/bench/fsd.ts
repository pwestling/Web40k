import { currentSlot } from "../../core/content/turn";
import { actingUnits } from "../../core/content/play";
import { act, goal, moveWith, positionOf, scene } from "./build";
import type { BenchItem, BenchSet } from "./judge";

/**
 * FSD (fsd-1.7) with the invented sample warbands: the Coalition Patrol
 * (seat 0, deciding) against the Syndicate. Distances in inches (a DU is 3").
 */
const SYSTEM = "fsd-1.7";

/** Seat 0 to activate, round 2, laid out by `lay`; the unit named by `go` activated. */
const table = (lay: Parameters<typeof scene>[3]) =>
  scene(
    SYSTEM,
    "activation",
    (s) =>
      s.turn.round === 2 &&
      s.turn.activeSeat === 0 &&
      currentSlot(s)?.kind === "alternate" &&
      !actingUnits(s).length,
    lay,
    { keep: /reserve/ },
  );

const item = (id: string, why: string, build: BenchItem["build"]): BenchItem => ({ id, why, build });

export const fsdBench: BenchSet = {
  system: SYSTEM,
  items: [
    item(
      "pin-the-free-gang",
      "Rifles at the gang still free to act, not the one already pinned",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Rifle Squad"), id("Raider Gang"), id("Raider Gang B"));
          t.place(id("Rifle Squad"), 0, 11).place(id("Raider Gang"), -3, 5).place(id("Raider Gang B"), 3, 5);
          t.flag(id("Raider Gang"), "pinned");
          t.activate(id("Rifle Squad"));
        });
        const s = t.s;
        return {
          p: positionOf(record, s, 0),
          better: act(s, id("Rifle Squad"), "fire", id("Raider Gang B"), "rifles"),
          worse: act(s, id("Rifle Squad"), "fire", id("Raider Gang"), "rifles"),
        };
      },
    ),
    item("finish-the-boss", "Rifles on the Boss Crew's last base, not a fresh gang", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Rifle Squad"), id("Boss Crew"), id("Raider Gang B"));
        t.place(id("Rifle Squad"), 0, 11).place(id("Boss Crew"), -3, 5).place(id("Raider Gang B"), 3, 5);
        t.hurt(id("Boss Crew"), 1);
        t.activate(id("Rifle Squad"));
      });
      const s = t.s;
      return {
        p: positionOf(record, s, 0),
        better: act(s, id("Rifle Squad"), "fire", id("Boss Crew"), "rifles"),
        worse: act(s, id("Rifle Squad"), "fire", id("Raider Gang B"), "rifles"),
      };
    }),
    item(
      "keep-command-safe",
      "The Command Team backs away from the Raiders' reach, not walk into it with nothing to shoot",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Command Team"), id("Raider Gang")).noObjectives();
          // 19" between the nearest bases: out of the Raiders' move and shot (18") until the team
          // walks 6" nearer, still beyond its own Rifles (9").
          t.place(id("Command Team"), -9, 0).place(id("Raider Gang"), 14, 0);
          t.activate(id("Command Team"));
        });
        const s = t.s;
        const u = id("Command Team");
        return {
          p: positionOf(record, s, 0),
          better: moveWith(s, u, "move", goal(s, u, 6, -15, 0)),
          worse: moveWith(s, u, "move", goal(s, u, 6, 14, 0)),
        };
      },
    ),
    item(
      "close-on-the-boss",
      "Rifles move into range of the Boss Crew's last base, not away from it",
      async () => {
        const { t, record, id } = await table((t, id) => {
          t.only(id("Rifle Squad"), id("Boss Crew")).noObjectives();
          t.hurt(id("Boss Crew"), 1);
          // 13" between the nearest bases: beyond the Rifles (9") until they move 6" nearer.
          t.place(id("Rifle Squad"), -6, 0).place(id("Boss Crew"), 10, 0);
          t.activate(id("Rifle Squad"));
        });
        const s = t.s;
        const u = id("Rifle Squad");
        return {
          p: positionOf(record, s, 0),
          better: moveWith(s, u, "move", goal(s, u, 6, 10, 0)),
          worse: moveWith(s, u, "move", goal(s, u, 6, -16, 0)),
        };
      },
    ),
    item("take-the-objective", "Onto an empty objective, not away from it", async () => {
      const { t, record, id } = await table((t, id) => {
        t.only(id("Rifle Squad"), id("Raider Gang"));
        t.place(id("Rifle Squad"), -9, 5).place(id("Raider Gang"), 9, -8);
        t.activate(id("Rifle Squad"));
      });
      const s = t.s;
      const u = id("Rifle Squad");
      return {
        p: positionOf(record, s, 0),
        better: moveWith(s, u, "move", goal(s, u, 6, -9, 0)),
        worse: moveWith(s, u, "move", goal(s, u, 6, -9, 0, true)),
      };
    }),
  ],
};
