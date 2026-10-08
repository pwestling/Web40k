import { WH40K_MISSIONS } from "./missions";
import { DEFAULT_SYSTEM, getSystem } from "../../core/content";
import type { GameModule } from "../../sdk";
import type { SystemModule } from "../app";
import { standardLayout } from "./layout";
import { sampleRoster } from "./sample";

/** Warhammer 40,000: the rules data in core/content/examples/forty-k.ts plus its own panels. */
export const wh40kModule: GameModule<SystemModule> = {
  id: DEFAULT_SYSTEM,
  version: getSystem(DEFAULT_SYSTEM).version,
  api: 1,
  system: getSystem(DEFAULT_SYSTEM),
  app: {
    sample: sampleRoster,
    layout: (t) => standardLayout(t.width, t.depth),
    dedicatedUi: true,
    secretObjectives: "Secret objectives",
    missions: WH40K_MISSIONS,
  },
};
