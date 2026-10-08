/**
 * How the built-in games are named and pitched on screen (front door). Plain
 * descriptions of how each one plays, never a publisher's names: the rules
 * engine is generic and every army comes from the player.
 */
export const FRONT: Record<string, { title: string; blurb: string; army: string }> = {
  "forty-k-11": {
    title: "Sci-fi battle",
    blurb: "Squads move, shoot, charge and fight, phase by phase. The rules do the dice maths.",
    army: "squads",
  },
  "fsd-1.7": {
    title: "Full Spectrum Dominance",
    blurb: "Fast sci-fi with alternating activations: one unit each, back and forth.",
    army: "units",
  },
  "tow-hand": {
    title: "Rank and flank",
    blurb: "Fantasy regiments in blocks: wheel, charge and hold the line. You roll, the table measures.",
    army: "regiments",
  },
  "conquest-hand": {
    title: "Conquest",
    blurb: "Regiments by hand, a card stack for activations, clash and volley.",
    army: "regiments",
  },
};

/** A game's name on screen: the front-door title for a built-in game, otherwise its own. */
export function systemLabel(id: string | undefined, name: string): string {
  return (id && FRONT[id]?.title) || name;
}
