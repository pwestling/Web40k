import type { GameState } from "../../core";
import { destroyed, edgeZones, enemyUnits, inside, objective, plural, seatOf } from "../../missions/common";
import type { Mission } from "../../sdk";
import { objectiveControl } from "./rules";

/**
 * Invented sample missions for 40k, written for Open Battle (no published
 * mission text or numbers). Published missions come in as player packages.
 */

/** Objectives each seat controls, by Objective Control (rules.ts). */
function controlled(game: GameState, seat: number): string[] {
  return objectiveControl(game)
    .filter((o) => o.controller !== null && seatOf(game, o.controller) === seat)
    .map((o) => o.id);
}

const otherSeat = (seat: number) => (seat === 0 ? 1 : 0);

const crossfire: Mission = {
  id: "crossfire",
  name: "Crossfire (sample)",
  summary:
    "Five objectives across the middle. At the end of your Command phase from round 2, score 5 VP for each one you control, up to 15.",
  setup: (t) => ({
    zones: edgeZones(t, 12),
    objectives: [
      objective("centre", 0, 0),
      objective("west", -t.width / 3, 0),
      objective("east", t.width / 3, 0),
      objective("north", 0, t.depth / 2 - 6),
      objective("south", 0, -(t.depth / 2 - 6)),
    ],
  }),
  scoring: [
    {
      id: "primary",
      name: "Crossfire",
      at: { phaseEnd: "command", fromRound: 2 },
      suggest: (game, seat) => {
        const mine = controlled(game, seat);
        return { vp: Math.min(15, 5 * mine.length), why: `controls ${plural(mine.length, "objective")}` };
      },
      ask: {
        question: "How many objectives do you control?",
        answers: [
          { label: "0", vp: 0, why: "controls no objectives" },
          { label: "1", vp: 5, why: "controls 1 objective" },
          { label: "2", vp: 10, why: "controls 2 objectives" },
          { label: "3+", vp: 15, why: "controls 3 or more objectives" },
        ],
      },
    },
  ],
  hand: 2,
  deck: [
    {
      id: "seize-centre",
      name: "Seize the centre",
      text: "5 VP if you control the centre objective.",
      ask: {
        question: "Do you control the centre objective?",
        answers: [
          { label: "Yes", vp: 5, why: "controls the centre" },
          { label: "No", vp: 0, why: "doesn't control the centre" },
        ],
      },
      suggest: (game, seat) =>
        controlled(game, seat).includes("centre")
          ? { vp: 5, why: "controls the centre" }
          : { vp: 0, why: "doesn't control the centre" },
    },
    {
      id: "behind-lines",
      name: "Behind their lines",
      text: "4 VP if one of your models stands in the enemy deployment zone.",
      ask: {
        question: "Does one of your models stand in the enemy deployment zone?",
        answers: [
          { label: "Yes", vp: 4, why: "a model is in their zone" },
          { label: "No", vp: 0, why: "nobody reached their zone" },
        ],
      },
      suggest: (game, seat) => {
        const zones = game.zones.filter((z) => z.seat !== seat);
        const there = Object.values(game.models).some(
          (m) => !m.destroyed && seatOf(game, m.owner) === seat && zones.some((z) => inside(m.position, z)),
        );
        return there
          ? { vp: 4, why: "a model is in their zone" }
          : { vp: 0, why: "nobody reached their zone" };
      },
    },
    {
      id: "hold-line",
      name: "Hold the line",
      text: "3 VP if no enemy model stands in your deployment zone.",
      ask: {
        question: "Is your deployment zone clear of enemy models?",
        answers: [
          { label: "Yes", vp: 3, why: "your zone is clear" },
          { label: "No", vp: 0, why: "an enemy is in your zone" },
        ],
      },
      suggest: (game, seat) => {
        const zones = game.zones.filter((z) => z.seat === seat);
        const intruder = Object.values(game.models).some(
          (m) =>
            !m.destroyed &&
            seatOf(game, m.owner) === otherSeat(seat) &&
            zones.some((z) => inside(m.position, z)),
        );
        return intruder ? { vp: 0, why: "an enemy is in your zone" } : { vp: 3, why: "your zone is clear" };
      },
    },
    {
      id: "outnumber",
      name: "Outnumber",
      text: "4 VP if you control more objectives than your opponent.",
      ask: {
        question: "Do you control more objectives than your opponent?",
        answers: [
          { label: "Yes", vp: 4, why: "more objectives than the opponent" },
          { label: "No", vp: 0, why: "not more objectives than the opponent" },
        ],
      },
      suggest: (game, seat) => {
        const mine = controlled(game, seat).length;
        const theirs = controlled(game, otherSeat(seat)).length;
        return mine > theirs
          ? { vp: 4, why: `${mine} objectives to ${theirs}` }
          : { vp: 0, why: `${mine} objectives to ${theirs}` };
      },
    },
    {
      id: "cull",
      name: "Cull the herd",
      text: "4 VP if two or more enemy units have been destroyed.",
      ask: {
        question: "Have two or more enemy units been destroyed?",
        answers: [
          { label: "Yes", vp: 4, why: "two or more enemy units destroyed" },
          { label: "No", vp: 0, why: "fewer than two enemy units destroyed" },
        ],
      },
      suggest: (game, seat) => {
        const n = enemyUnits(game, seat).filter((u) => destroyed(game, u)).length;
        return n >= 2
          ? { vp: 4, why: `${plural(n, "enemy unit")} destroyed` }
          : { vp: 0, why: `${n} destroyed` };
      },
    },
  ],
};

export const WH40K_MISSIONS: Mission[] = [crossfire];
