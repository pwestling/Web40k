import {
  appendEvent,
  applyEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  sides,
  stateAt,
  type GameRecord,
  type GameState,
  type Intent,
  type LoggedEvent,
} from "../core";
import { registerFunctions } from "../core/content/calls";
import { extendSystem, listSystems, type SystemAdditions } from "../core/content/systems";
import { currentSlot, systemOf } from "../core/content/turn";
import { gameView, hookProcedures, registerCode } from "../core/script";
import { systemMatches } from "../packages/library";
import { readManifest } from "../packages/manifest";
import type { CodeAction, GameModule, PackageApp, PackageContents, PanelSpec } from "../sdk";
import { registerModule, type SystemModule } from "../systems";
import { expandLayout } from "../systems/packageLayout";
import { shapeProblems } from "../core/content/shape";
import { momentMatches, moments } from "../missions/scoring";
import {
  seededRng,
  type ActionRow,
  type AppState,
  type Loaded,
  type Provided,
  type Resolved,
} from "./protocol";

/**
 * An error from a package's code, with where in its file it was thrown when
 * the stack says (a blob module's line and column), for the workshop to mark.
 */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // The package's own frames: blob (or data) modules other than this worker's own script.
  const own = (globalThis as { location?: { href?: string } }).location?.href;
  for (const m of (e.stack ?? "").matchAll(/((?:blob:|data:)[^\s)]*?):(\d+):(\d+)/g))
    if (m[1] !== own) return `${e.message} (line ${m[2]}, column ${m[3]})`;
  return e.message;
}

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
  /** Whole-game packages' app glue by system id. */
  private readonly apps = new Map<string, SystemModule & PackageApp>();
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
        let provides: Provided | undefined;
        if (contents.module) {
          // A whole game: its module registers here as a built-in one would, and the app gets
          // its rules data plus what its app glue gives for a fresh game.
          const given = contents.module as GameModule<SystemModule>;
          // A hand-written system's shape is checked first, so a typo is named rather than breaking play.
          const shape = shapeProblems(given.system);
          if (shape.length) throw new Error(shape.join("; "));
          const raw = given.app as (SystemModule & PackageApp) | undefined;
          // Terrain named by template is made into pieces here, so every caller of layout gets them.
          const app = raw && {
            ...raw,
            layout: (t: Parameters<PackageApp["layout"]>[0]) =>
              expandLayout(raw.layout(t), raw.templateCategory),
          };
          const m = { ...given, ...(app ? { app } : {}) };
          registerModule(m);
          if (app) this.apps.set(m.system.id, app);
          const table = m.system.defaultTable ?? createInitialState().table;
          const missions = (app?.missions ?? []).map((mission) => ({
            id: mission.id,
            name: mission.name,
            summary: mission.summary,
            ...(mission.hand !== undefined ? { hand: mission.hand } : {}),
            table: { width: table.width, depth: table.depth },
            setup: mission.setup(table),
            scoring: mission.scoring.map(({ suggest: _s, ...rule }) => rule),
            ...(mission.deck ? { deck: mission.deck.map(({ suggest: _s, ...card }) => card) } : {}),
          }));
          provides = JSON.parse(
            JSON.stringify({
              system: m.system,
              app: {
                samples: app ? [app.sample(0), app.sample(1)] : [],
                armies: app?.armies ?? [],
                missions,
                layout: app ? app.layout(table) : { terrain: [], objectives: [], zones: [] },
                templateCategory: app?.templateCategory,
                templates: app?.templates,
                specialDice: app?.specialDice,
                scatter: app?.scatter,
                fleeDice: app?.fleeDice,
                chargeRoll: app?.chargeRoll,
                has: {
                  importRoster: !!app?.importRoster,
                  rankRules: !!app?.rankRules,
                  leaving: !!app?.leaving,
                  sidePanel: !!app?.sidePanel,
                  missions: missions.length > 0,
                },
              },
            }),
          ) as Provided;
          if (m.actions) this.actions.set(m.system.id, m.actions);
        }
        const systems = listSystems()
          .map((s) => s.id)
          .filter((id) => read.manifest.systems.some((d) => systemMatches(d, id)));
        const actions = (contents.actions ?? []).filter((a): a is CodeAction => "run" in a);
        // Data the package adds: the same on both sides, so the app's previews and panels see it too.
        const data: SystemAdditions = JSON.parse(
          JSON.stringify({
            rules: contents.rules ?? [],
            actions: (contents.actions ?? []).filter((a) => !("run" in a)),
            abilityTimings: contents.abilityTimings ?? [],
          }),
        );
        // A whole game's hooks were registered with its module; report their ids for the host.
        const moduleHooks = contents.module?.hooks;
        const hooked = contents.hooks
          ? hookProcedures(hash.slice(0, 8), contents.hooks)
          : moduleHooks
            ? hookProcedures(contents.module!.system.id, moduleHooks)
            : null;
        for (const system of systems) {
          extendSystem(system, data);
          if (hooked) registerCode(system, hooked.procedures);
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
          procedures: [...Object.keys(contents.procedures ?? {}), ...Object.keys(hooked?.procedures ?? {})],
          actions: actions.map((a) => a.id),
          data,
          hooks: hooked?.table ?? {},
          ...(provides ? { provides } : {}),
        });
      } catch (e) {
        out.errors.push({ hash, error: errorText(e) });
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

  private setupKey = "";
  private setups: AppState["setups"] = {};

  /** A package game's rank rules, unfinished business and panel for the game as it stands. */
  appState(): AppState {
    const system = systemOf(this.state).id;
    const app = this.apps.get(system);
    const ranks: AppState["ranks"] = {};
    if (app?.rankRules)
      for (const u of Object.values(this.state.units)) ranks[u.id] = app.rankRules(this.state, u);
    const panel = app?.sidePanel ? app.sidePanel(gameView(this.state, system)) : null;
    // The chosen mission's suggestions, for every scoring moment so far and every card.
    const scores: AppState["scores"] = {};
    const cards: AppState["cards"] = {};
    const mission = app?.missions?.find((m) => m.id === this.state.mission?.id);
    if (mission) {
      for (const moment of moments(this.record))
        for (const rule of mission.scoring) {
          if (!momentMatches(rule.at, moment)) continue;
          for (const seat of moment.kind === "phaseEnd" ? [moment.seat!] : sides(moment.state))
            scores[`${rule.id}:${moment.round}:${seat}`] = rule.suggest(moment.state, seat);
        }
      for (const card of mission.deck ?? [])
        for (const seat of sides(this.state)) cards[`${card.id}:${seat}`] = card.suggest(this.state, seat);
    }
    // Every mission's setup at the table played on, not scaled from the default one (#43).
    const { width, depth } = this.state.table;
    const key = `${system}:${width}x${depth}`;
    if (this.setupKey !== key) {
      this.setupKey = key;
      this.setups = {};
      for (const m of app?.missions ?? [])
        try {
          this.setups[m.id] = JSON.parse(
            JSON.stringify(m.setup(this.state.table)),
          ) as AppState["setups"][string];
        } catch {
          // The app falls back to the default table's setup, scaled.
        }
    }
    const ready: AppState["ready"] = {};
    if (this.actions.get(system)?.length)
      for (const u of Object.values(this.state.units)) {
        const names = this.unitActions(u.id, u.owner)
          .filter((r) => r.available === true)
          .map((r) => r.name);
        if (names.length) ready[u.id] = names;
      }
    return {
      seq: this.state.seq,
      ready,
      setups: this.setups,
      table: app?.missions?.length ? { width, depth } : null,
      scores: JSON.parse(JSON.stringify(scores)) as AppState["scores"],
      cards: JSON.parse(JSON.stringify(cards)) as AppState["cards"],
      ranks,
      leaving: app?.leaving ? app.leaving(this.state) : [],
      panel: panel ? (JSON.parse(JSON.stringify(panel)) as PanelSpec) : null,
    };
  }

  /** Read an army list with the package game's own reader. */
  async importRoster(fileName: string, data: Uint8Array): Promise<unknown> {
    const app = this.apps.get(systemOf(this.state).id);
    if (!app?.importRoster) throw new Error("This game has no army list reader");
    return JSON.parse(JSON.stringify(await app.importRoster(fileName, data)));
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
