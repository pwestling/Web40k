import {
  appendEvent,
  applyEvent,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type GameState,
  type Intent,
  type LoggedEvent,
} from "../core";
import { registerFunctions } from "../core/content/calls";
import { listSystems } from "../core/content/systems";
import { currentSlot, systemOf } from "../core/content/turn";
import { gameView, registerCode } from "../core/script";
import { systemMatches } from "../packages/library";
import { readManifest } from "../packages/manifest";
import type { CodeAction, PackageContents } from "../sdk";
import "../systems";
import { seededRng, type ActionRow, type Loaded, type Resolved } from "./protocol";

/** How the engine turns a package's source into its module (a blob import in the worker). */
export type ImportSource = (source: string) => Promise<{ default?: unknown }>;

/**
 * The game engine as it runs inside the package sandbox: the built-in
 * systems plus the packages' code, and a replica of the game record that
 * the app keeps in step by forwarding each logged event. It is plain code
 * (no Worker or DOM), so tests can run it next to the app's own engine and
 * check both give the same events (sandbox.test.ts).
 */
export class SandboxEngine {
  private record: GameRecord = createRecord();
  private state: GameState = stateAt(this.record);
  /** Package code actions by system id. */
  private readonly actions = new Map<string, CodeAction[]>();

  constructor(private readonly importSource: ImportSource) {}

  async load(packages: { hash: string; source: string }[]): Promise<Loaded> {
    const out: Loaded = { packages: [], errors: [] };
    for (const { hash, source } of packages) {
      try {
        const read = readManifest(source);
        if ("error" in read) throw new Error(read.error);
        const mod = await this.importSource(source);
        const contents = (mod.default ?? {}) as PackageContents;
        if (contents.module) throw new Error("Whole-system packages aren't supported in the sandbox yet");
        const systems = listSystems()
          .map((s) => s.id)
          .filter((id) => read.manifest.systems.some((d) => systemMatches(d, id)));
        const actions = (contents.actions ?? []).filter((a): a is CodeAction => "run" in a);
        for (const system of systems) {
          if (contents.procedures) registerCode(system, contents.procedures);
          if (contents.functions) registerFunctions(system, contents.functions);
          registerCode(system, Object.fromEntries(actions.map((a) => [a.id, a.run])));
          this.actions.set(system, [
            ...(this.actions.get(system) ?? []).filter((a) => !actions.some((b) => b.id === a.id)),
            ...actions,
          ]);
        }
        out.packages.push({
          hash,
          systems,
          procedures: Object.keys(contents.procedures ?? {}),
          actions: actions.map((a) => a.id),
        });
      } catch (e) {
        out.errors.push({ hash, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  init(record: GameRecord): void {
    this.record = record;
    this.state = stateAt(record);
  }

  /** Fold logged events in, as a peer does (undo rebuilds from the record). */
  events(events: LoggedEvent[]): void {
    for (const logged of events) {
      if (logged.seq <= (this.record.events.at(-1)?.seq ?? 0)) continue;
      this.record = appendEvent(this.record, logged);
      this.state =
        logged.event.type === "undo"
          ? stateAt(this.record)
          : { ...applyEvent(this.state, logged.event), seq: logged.seq };
    }
  }

  /** The host's job for one intent, with dice from `seed`. */
  resolve(intent: Intent, from: string, seed: number): Resolved {
    return resolveLogged(this.record, intent, from, seededRng(seed), 0, this.state)?.event ?? null;
  }

  /** The packages' code actions for a unit in this phase, as the unit card lists them. */
  unitActions(unitId: string, player: string): ActionRow[] {
    const system = systemOf(this.state).id;
    if (!this.state.units[unitId]) return [];
    const view = gameView(this.state, system);
    const actor = { player, unitId };
    const phase = currentSlot(this.state)?.id;
    return (this.actions.get(system) ?? [])
      .filter((a) => a.by === "unit" && (!a.phases || (phase && a.phases.includes(phase))))
      .filter((a) => !a.applies || a.applies(view, actor))
      .map((a) => {
        const available = a.available(view, actor);
        return {
          id: a.id,
          name: a.name,
          available: available === true ? true : String(available),
          targets: available === true && a.targets ? a.targets(view, actor) : [],
          targeted: !!a.targets,
        };
      });
  }
}
