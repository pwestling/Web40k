import { fsd } from "../../core/content/examples/fsd";
import type { GameModule } from "../../sdk";
import type { SystemModule } from "../app";
import { fsdLayout, FSD_CATEGORIES } from "./layout";
import { fsdSample } from "./sample";

/** Full Spectrum Dominance: rules data in core/content/examples/fsd.ts. */
export const fsdModule: GameModule<SystemModule> = {
  id: fsd.id,
  version: fsd.version,
  api: 1,
  system: fsd,
  app: {
    sample: fsdSample,
    layout: (t) => fsdLayout(t.width, t.depth),
    templateCategory: FSD_CATEGORIES,
  },
};
