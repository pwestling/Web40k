import { DEFAULT_SYSTEM, type Layout, type Table } from "../core";
import { fsdLayout, FSD_CATEGORIES } from "./fsd/layout";
import { fsdSample } from "./fsd/sample";
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
}

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
