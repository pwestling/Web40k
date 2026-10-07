import { DEFAULT_SYSTEM, type GameState, type Layout, type Table, type Unit } from "../core";
import { registerSystem } from "../core/content";
import { fsdLayout, FSD_CATEGORIES } from "./fsd/layout";
import { fsdSample } from "./fsd/sample";
import { oldWorld } from "./tow/system";
import { towLayout, TOW_CATEGORIES } from "./tow/layout";
import { towSample } from "./tow/sample";
import { towRanks } from "./tow/troops";
import { standardLayout } from "./wh40k/layout";
import type { ImportedRoster } from "./wh40k/roster";
import { sampleRoster } from "./wh40k/sample";

/**
 * What the app needs from each game system besides its rules data: a table
 * to start on, sample armies, and how the shared terrain templates map to the
 * system's terrain categories. Rules live in core/content as data.
 */
export interface SystemModule {
  /** Sample army for a seat. */
  sample(seat: 0 | 1): ImportedRoster;
  layout(table: Table): Layout;
  /** Category for each terrain template name, when the system has its own categories. */
  templateCategory?: Record<string, string>;
  /**
   * The system has its own panels (40k: the attack editor and phase moves);
   * other systems use the generic actions and procedure panels.
   */
  dedicatedUi?: boolean;
  /** Rank width and rank bonus cap for a regiment (rank-and-flank systems); else the system's constants. */
  rankRules?(game: GameState, unit: Unit): { width: number; maxBonus: number };
}

// Systems defined here rather than in core/content register themselves.
registerSystem(oldWorld);

const MODULES: Record<string, SystemModule> = {
  [DEFAULT_SYSTEM]: {
    sample: sampleRoster,
    layout: (t) => standardLayout(t.width, t.depth),
    dedicatedUi: true,
  },
  "fsd-1.7": {
    sample: fsdSample,
    layout: (t) => fsdLayout(t.width, t.depth),
    templateCategory: FSD_CATEGORIES,
  },
  [oldWorld.id]: {
    sample: towSample,
    layout: (t) => towLayout(t.width, t.depth),
    templateCategory: TOW_CATEGORIES,
    rankRules: towRanks,
  },
};

/** The module for a system id; systems without one get the generic panels and an empty table. */
export function systemModule(id: string | undefined): SystemModule {
  return (
    MODULES[id ?? DEFAULT_SYSTEM] ?? {
      sample: () => ({ name: "Empty", units: [], warnings: [] }),
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    }
  );
}
