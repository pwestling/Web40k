import { describe } from "vitest";
import brinewatch from "../../games/brinewatch/brinewatch.js?raw";
import type { GameEvent, GameState } from "../core";
import { moveWarnings, scenarioSuite } from "./suite";
import { SandboxEngine } from "../sandbox/engine";

/** The package's own crews, for the second suite: the Deepkin against the Tollkeepers. */
const engine = new SandboxEngine(
  (source) => import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`),
);
const crews = (await engine.load([{ hash: "bw", source: brinewatch }])).packages[0]!.provides!.app
  .armies as never[];

/**
 * Brinewatch (#69, a whole skirmish game from a package) played by the soak
 * bot: every rule in docs/rules-coverage/brinewatch.md that comes up in play
 * is tagged here, and each must come up in some game. A model never takes a
 * second go in a round, nor spends action points it doesn't have.
 */
const inner = (events: GameEvent[]): GameEvent[] =>
  events.flatMap((e) => (e.type === "script/step" ? [e, ...e.events] : [e]));

const notes = (events: GameEvent[]) => inner(events).flatMap((e) => (e.type === "log/note" ? [e.text] : []));

const watch = (s: GameState, events: GameEvent[], before: GameState): string[] => {
  const tags: string[] = [];
  const all = inner(events);
  for (const e of events) {
    if (e.type === "script/step" && e.started && e.unit) {
      const was = before.units[e.unit];
      if (was?.status?.activated && !was.status.acting) tags.push("a second go in a round");
      const after = s.units[e.unit];
      if (Number(after?.status?.actionsTaken ?? 0) > Number(after?.status?.actionBudget ?? 2) + 0.01)
        tags.push("more action points than it had");
      tags.push(`action ${e.started}`);
      if (was?.status?.acting) tags.push("a second action in one go");
      if (after && !after.status?.acting && after.status?.activated && !e.script)
        tags.push("the go ended with its points spent");
    }
    if (e.type === "models/move" && !e.setup && s.turn.round > 0) {
      const unit = s.models[e.moves[0]?.id ?? ""]?.unitId;
      const was = unit ? before.units[unit] : undefined;
      if (was?.status?.acting) tags.push("moved again in the same go");
      if (e.moves.some((m) => (m.z ?? 0) >= 2)) tags.push("climbed onto a floor");
    }
    if (e.type === "turn/next" || (e.type === "script/step" && before.turn.round !== s.turn.round))
      if (s.turn.round > before.turn.round && s.turn.round > 1)
        if (Object.values(s.units).every((u) => !u.status?.activated)) tags.push("every model ready again");
  }
  for (const e of all) {
    if (
      e.type === "unit/status" &&
      e.key === "actionsTaken" &&
      Number(e.value) < Number(before.units[e.id]?.status?.actionsTaken ?? 0)
    )
      tags.push("Undertow gave a point back");
    if (
      e.type === "unit/status" &&
      e.key === "actionsTaken" &&
      Number(e.value) > Number(before.units[e.id]?.status?.actionsTaken ?? 0)
    )
      tags.push("spent action points");
    if (e.type === "secret/commit") tags.push("a lurker's hideout committed in secret");
    if (e.type === "secret/reveal") tags.push("a lurker's hideout revealed");
    if (e.type === "unit/reserve" && e.reserve) tags.push("a lurker hid");
    if (e.type === "model/wounds" && e.destroyed) tags.push("a model out of action");
    if (e.type === "dice/roll" && /\(cover\)/.test(e.roll.label ?? "")) tags.push("a save in cover");
    if (e.type === "campaign/award") tags.push("a campaign award");
  }
  for (const n of notes(events)) {
    if (/vantage/.test(n)) tags.push("a shot with vantage");
    if (/obscured/.test(n)) tags.push("an obscured shot");
    if (/Long Eye/.test(n)) tags.push("Long Eye");
    if (/on guard, sees .* move$/.test(n)) tags.push("a guard fired at a model that moved");
    if (/on guard, sees .* (take aim|close in to fight)$/.test(n))
      tags.push("a guard fired at a model that acted");
    if (/on guard, sees .* come out of hiding$/.test(n)) tags.push("a guard fired at a lurker emerging");
    if (/Steady Watch/.test(n)) tags.push("Steady Watch");
    if (/Slippery/.test(n)) tags.push("Slippery");
    if (/Undertow/.test(n)) tags.push("Undertow");
    if (/ fights /.test(n)) tags.push("a fight");
    if (/emerges from/.test(n))
      tags.push(
        s.turn.round >= 3 && !events.some((e) => e.type === "script/step" && e.started === "emerge")
          ? "a lurker emerged at round 3"
          : "a lurker emerged",
      );
  }
  tags.push(...moveWarnings(s, events));
  return tags;
};

describe("Brinewatch in play", () =>
  scenarioSuite(
    "Brinewatch goes, guards and lurkers",
    "brinewatch",
    { watch, systemPkg: { source: brinewatch }, maxSteps: 4000, minSeeds: 4 },
    [
      "action shoot",
      "action fight",
      "action guard",
      "action emerge",
      "a second action in one go",
      "moved again in the same go",
      "spent action points",
      "the go ended with its points spent",
      "every model ready again",
      "climbed onto a floor",
      "a shot with vantage",
      "a save in cover",
      "an obscured shot",
      "a guard fired at a model that moved",
      "a guard fired at a model that acted",
      "a fight",
      "a model out of action",
      "a lurker hid",
      "a lurker's hideout committed in secret",
      "a lurker's hideout revealed",
      "a lurker emerged",
      "warning moveDistance",
    ],
    ["a second go in a round", "more action points than it had"],
  ));

describe("Brinewatch in play: the Deepkin", () =>
  scenarioSuite(
    "Brinewatch Deepkin against Tollkeepers",
    "brinewatch",
    {
      watch,
      systemPkg: { source: brinewatch },
      maxSteps: 4000,
      minSeeds: 4,
      armies: (seat) => crews[seat === 0 ? 2 : 0]!,
    },
    ["action fight", "Steady Watch", "a guard fired at a model that acted", "a lurker emerged"],
    ["a second go in a round", "more action points than it had"],
  ));
