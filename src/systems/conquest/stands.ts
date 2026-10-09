import { blockModels } from "../../core/regiment";
import { isAlive } from "../../core/units";
import type { GameState, Model, Unit } from "../../core/types";
import { edgeZones, held, objective, plural, seatOf } from "../../missions/common";
import type { GameView, Mission, Warning } from "../../sdk";

/**
 * Stands, the Warlord and objective zones (research/conquest-rules.md,
 * Stands, Scenarios). Our own paraphrase; the scenario points are marked
 * [secondary] in the notes and are unverified.
 *
 *  - A stand's models and Size follow its regiment's type.
 *  - The command stand stands in the centre of the front rank (beside a
 *    character who joined it there): advisory, the player moves it.
 *  - One Warlord in an army, and each character leads one to four
 *    regiments: advisory list checks.
 *  - Objective zones are seized by the side with more seize value in them
 *    (Light 0, Medium and Heavy 1, Monster 3), then more stands.
 */

/** Models on a stand and its Size, by regiment type: infantry four to a stand, monsters the biggest. */
export function standOf(type: string | undefined): { models: number; size: number } {
  const t = (type ?? "").toLowerCase();
  if (t === "monster") return { models: 1, size: 3 };
  if (t === "cavalry" || t === "brute" || t === "chariot") return { models: 1, size: 2 };
  return { models: 4, size: 1 };
}

/** What a stand adds to seizing an objective zone: Light 0, Medium and Heavy 1, Monster 3. */
function seizeValue(model: Pick<Model, "profile">): number {
  const chars = model.profile?.chars ?? {};
  if (/^monster$/i.test(chars.Type ?? "")) return 3;
  return /^light$/i.test(chars.Class ?? "") ? 0 : 1;
}

const isCharacter = (u: Unit) => (u.sheet?.keywords ?? []).some((k) => /^character$/i.test(k));
const isWarlord = (u: Unit) => (u.sheet?.keywords ?? []).some((k) => /^warlord$/i.test(k));

/** Which slot index the command stand should hold: the centre of the front rank (either middle one if even). */
function centred(index: number, files: number): boolean {
  if (files % 2) return index === (files - 1) / 2;
  return index === files / 2 - 1 || index === files / 2;
}

/** A regiment whose command stand isn't in the centre of its front rank (or, with a character there, in the front rank). */
function commandOutOfPlace(state: GameState, unit: Unit): boolean {
  if (unit.formation.kind !== "ranked") return false;
  const all = blockModels(state, unit, false);
  const files = Math.max(1, Math.min(unit.formation.files, all.length));
  if (files < 3) return false;
  const index = all.findIndex((m) => !m.destroyed && /\bcommand\b/i.test(m.profile?.name ?? ""));
  if (index < 0) return false;
  const characters = new Set((unit.joined ?? []).flatMap((u) => u.modelIds));
  const characterInFront = all.slice(0, files).some((m) => characters.has(m.id) && !m.destroyed);
  return characterInFront ? index >= files : !centred(index, files);
}

/** Table and list checks: the command stand's place, the Warlord, and how many regiments the characters lead. */
export function standWarnings(view: GameView): Warning[] {
  const state = view.state;
  const out: Warning[] = [];
  if (!view.atTable)
    for (const unit of Object.values(state.units))
      if (isAlive(state, unit) && commandOutOfPlace(state, unit))
        out.push({
          id: "commandStand",
          unitId: unit.id,
          message: `${unit.name}: the command stand belongs in the centre of the front rank`,
        });
  for (const player of Object.keys(state.players)) {
    const units = Object.values(state.units).filter((u) => u.owner === player);
    if (!units.length) continue;
    const name = state.players[player]?.name ?? player;
    // A character that joined a regiment still counts.
    const all = units.flatMap((u) => [u, ...(u.joined ?? [])]);
    const characters = all.filter(isCharacter);
    const regiments = units.filter((u) => !isCharacter(u)).length;
    const warlords = all.filter(isWarlord).length;
    if (warlords !== 1)
      out.push({
        id: "warlord",
        unitId: characters[0]?.id ?? units[0]!.id,
        message: `${name}'s army has ${plural(warlords, "Warlord")}: name one character the Warlord`,
      });
    if (characters.length && (regiments < characters.length || regiments > characters.length * 4))
      out.push({
        id: "regimentsPerCharacter",
        unitId: characters[0]!.id,
        message: `${name}'s army has ${plural(regiments, "regiment")} for ${plural(characters.length, "character")}: each character leads 1 to 4`,
      });
  }
  return out;
}

/** The seat seizing each objective: more seize value within `zone` inches, then more stands; nobody on a tie. */
export function seizers(game: GameState, zone: number): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const o of game.objectives) {
    const by: Record<number, { value: number; stands: number }> = {};
    for (const m of Object.values(game.models)) {
      if (m.destroyed || !m.unitId) continue;
      if (game.units[m.unitId]?.status?.reserves) continue;
      if (Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) > zone) continue;
      const seat = seatOf(game, m.owner);
      if (seat === undefined) continue;
      const t = (by[seat] ??= { value: 0, stands: 0 });
      t.value += seizeValue(m);
      t.stands += 1;
    }
    const ranked = Object.entries(by).sort((a, b) => b[1].value - a[1].value || b[1].stands - a[1].stands);
    const [first, second] = ranked;
    const tie = second && second[1].value === first![1].value && second[1].stands === first![1].stands;
    // Light stands alone (seize value 0) can't seize a zone.
    out[o.id] = first && !tie && first[1].value > 0 ? Number(first[0]) : null;
  }
  return out;
}

/**
 * An invented sample mission with Conquest's objective zones: three
 * objectives with 6" zones on the centre line, 1 VP for each one a side
 * seizes at the end of every round.
 */
export function seizeTheField(zone = 6): Mission {
  return {
    id: "seize-the-field",
    name: "Seize the Field (sample)",
    summary: `Three objective zones (${zone}") on the centre line. At the end of each round, 1 VP for each you seize: the most seize value in the zone (Light 0, Medium and Heavy 1, Monster 3), then the most stands.`,
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
        id: "seize",
        name: "Seize the Field",
        at: { roundEnd: true },
        suggest: (game, seat) => {
          const mine = held(seizers(game, zone), seat);
          return { vp: mine.length, why: `seizes ${plural(mine.length, "objective")}` };
        },
      },
    ],
  };
}
