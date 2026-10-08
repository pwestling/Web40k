import { edgeZones, held, holders, objective, plural } from "./common";
import type { Mission } from "../sdk";

/**
 * An invented sample mission any game can use: three objectives on the
 * centre line, 1 VP for each one a side holds (most models within 3") at
 * the end of every round.
 */
export function holdTheField(range = 3): Mission {
  return {
    id: "hold-the-field",
    name: "Hold the Field (sample)",
    summary: `Three objectives on the centre line. At the end of each round, 1 VP for each one you hold: the most models within ${range}".`,
    setup: (t) => ({
      zones: edgeZones(t, 12),
      objectives: [
        objective("centre", 0, 0),
        objective("left", -t.width / 4, 0),
        objective("right", t.width / 4, 0),
      ],
    }),
    scoring: [
      {
        id: "hold",
        name: "Hold the Field",
        at: { roundEnd: true },
        suggest: (game, seat) => {
          const mine = held(holders(game, range), seat);
          return { vp: mine.length, why: `holds ${plural(mine.length, "objective")}` };
        },
      },
    ],
  };
}
