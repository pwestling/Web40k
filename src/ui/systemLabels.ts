import { DEFAULT_SYSTEM, type GameState } from "../core";
import { getSystem, isPlaceholder } from "../core/content/systems";
import { t } from "../i18n";
import { useLibrary } from "../packages/library";

/**
 * How the built-in games are named and pitched on screen (front door). Plain
 * descriptions of how each one plays, never a publisher's names: the rules
 * engine is generic and every army comes from the player. Getters, so the
 * text is in the chosen language when it's read.
 */
export const FRONT: Record<string, { title: string; blurb: string; army: string }> = {
  "forty-k-11": {
    get title() {
      return t("Sci-fi battle");
    },
    get blurb() {
      return t("Squads move, shoot, charge and fight, phase by phase. The rules do the dice maths.");
    },
    get army() {
      return t("squads");
    },
  },
  "fsd-1.7": {
    title: "Full Spectrum Dominance", // i18n-ignore
    get blurb() {
      return t("Fast sci-fi with alternating activations: one unit each, back and forth.");
    },
    get army() {
      return t("units");
    },
  },
  "tow-hand": {
    get title() {
      return t("Rank and flank");
    },
    get blurb() {
      return t("Fantasy regiments in blocks: wheel, charge and hold the line. You roll, the table measures.");
    },
    get army() {
      return t("regiments");
    },
  },
  "conquest-hand": {
    title: "Conquest", // i18n-ignore
    get blurb() {
      return t("Regiments by hand, a card stack for activations, clash and volley.");
    },
    get army() {
      return t("regiments");
    },
  },
};

/** A game's name on screen: the front-door title for a built-in game, otherwise its own. */
export function systemLabel(id: string | undefined, name: string): string {
  return (id && FRONT[id]?.title) || name;
}

/** A game's name for players: "(draft)" marks a system still being built inside the app, not for a post or a list. */
export function plainSystemName(name: string): string {
  return name.replace(/\s*\(draft\)\s*$/i, "");
}

/** The game a state is of, by its name on screen (a package game not loaded yet: its id). */
export function gameTitle(state: GameState): string {
  const id = state.system ?? DEFAULT_SYSTEM;
  let name = id;
  try {
    name = plainSystemName(getSystem(id).name);
  } catch {
    // A package game that isn't loaded yet: its id will do.
  }
  // Not loaded yet (the lobby's Resume tile): the package the game names says what it is.
  if (isPlaceholder(id))
    name = state.packages?.packages.find((p) => p.id === id)?.name ?? state.packages?.packages[0]?.name ?? id;
  return systemLabel(id, name);
}

/**
 * A game system's name for players, from its id alone (a ladder, a ranked
 * result: #65); a package game not loaded yet goes by its package's name (UX 451).
 */
export function systemTitle(id: string): string {
  const title = gameTitle({ system: id } as GameState);
  if (title !== id && !isPlaceholder(id)) return title;
  const pkg = Object.values(useLibrary.getState().packages).find((p) => p.manifest.systems[0] === id);
  return pkg ? plainSystemName(pkg.manifest.name) : title;
}
