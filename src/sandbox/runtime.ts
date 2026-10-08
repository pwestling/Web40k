import { useEffect } from "react";
import { create } from "zustand";
import type { GameRecord, GameState, Unit, Vec2 } from "../core";
import { systemOf } from "../core/content/turn";
import { extendSystem, restoreSystems } from "../core/content/systems";
import { registerHooks, unregisterHooks } from "../core/script";
import { setIntentRouter } from "../net/session";
import { registerPackageSystem, unregisterPackageSystem } from "../systems";
import { useLibrary } from "../packages/library";
import { useStore } from "../store";
import { Sandbox, STARTUP_MS } from "./host";
import type { ActionRow, AppState, Loaded, Provided, ProvidedMission } from "./protocol";
import type { Mission } from "../sdk";
import type { ImportedRoster } from "../systems/wh40k/roster";

/**
 * The game's trusted rules packages running in the sandbox: started when the
 * game names packages this player trusts, fed every logged event, asked for
 * package actions by the unit card, and handed the host's intents for
 * package procedures (setIntentRouter).
 */
interface SandboxState {
  status: "off" | "starting" | "on" | "stopped";
  /** Why it stopped, for the players. */
  error: string | null;
  /** Package procedure and action ids, by system id. */
  code: Record<string, string[]>;
  /** Unit card rows, by `${seq}:${unitId}`. */
  rows: Record<string, ActionRow[]>;
  /** A package game's rank rules, unfinished business and panel, as of `app.seq`. */
  app: AppState | null;
}

export const useSandbox = create<SandboxState>(() => ({
  status: "off",
  error: null,
  code: {},
  rows: {},
  app: null,
}));

/** Whether the game being played comes from a package with game-dependent app glue to ask about. */
let wantsAppState = false;
let askedFor = -1;

/** Ask the sandbox for the package game's app state once per new event. */
function refreshApp(): void {
  const seq = useStore.getState().record.events.at(-1)?.seq ?? 0;
  if (!sandbox || !wantsAppState || askedFor === seq) return;
  askedFor = seq;
  sandbox
    .call<AppState>({ t: "appState" })
    .then((app) => useSandbox.setState({ app }))
    .catch(() => {});
}

let sandbox: Sandbox | null = null;
/** The record the worker holds, and how far it has been sent. */
let sent: { record: GameRecord; seq: number } | null = null;

/** Send the worker whatever it hasn't seen of the record, or the whole record if history changed. */
function sync(): void {
  if (!sandbox) return;
  const record = useStore.getState().record;
  if (sent?.record === record) return;
  const prev = sent;
  const last = record.events.at(-1)?.seq ?? 0;
  const at = prev ? record.events.findIndex((e) => e.seq > prev.seq) : -1;
  const continues =
    prev &&
    record.initial === prev.record.initial &&
    record.events.length >= prev.record.events.length &&
    record.events[prev.record.events.length - 1] === prev.record.events.at(-1);
  if (continues) {
    const events = at < 0 ? [] : record.events.slice(at);
    if (events.length) void sandbox.call({ t: "events", events }, STARTUP_MS).catch(() => {});
  } else void sandbox.call({ t: "init", record }, STARTUP_MS).catch(() => {});
  sent = { record, seq: last };
  refreshApp();
}

/** Take the packages' data and hooks back off the app's systems. */
function unload() {
  wantsAppState = false;
  askedFor = -1;
  useSandbox.setState({ app: null });
  restoreSystems();
  for (const id of provided.splice(0)) unregisterPackageSystem(id);
  for (const owner of hookOwners.splice(0)) unregisterHooks(owner);
}
const hookOwners: string[] = [];
/** Systems whole-game packages registered on the app's side. */
const provided: string[] = [];

/** Register a whole-game package's system here, and refold the game, which was folded with a stand-in. */
function provide(p: Provided): void {
  const { samples, layout, has, armies, missions, ...rest } = p.app;
  const empty = { name: "Empty", units: [], warnings: [] };
  const constant = (key: string, fallback: number) => p.system.constants?.[key] ?? fallback;
  // Package games with code actions say what's ready for "What can I do now?" too.
  wantsAppState = true;
  registerPackageSystem(p.system, {
    ...rest,
    sample: (seat) => samples[seat] ?? empty,
    layout: () => layout,
    ...(armies.length ? { armies } : {}),
    ...(missions.length ? { missions: missions.map(packageMission) } : {}),
    // Code hooks run in the sandbox; the app reads what it last worked out.
    ...(has.importRoster
      ? {
          importRoster: (fileName: string, data: Uint8Array) => {
            if (!sandbox) return Promise.reject(new Error("The game's rules package isn't running"));
            return sandbox.call<ImportedRoster>({ t: "importRoster", fileName, data }, STARTUP_MS);
          },
        }
      : {}),
    ...(has.rankRules
      ? {
          rankRules: (_game: GameState, unit: Unit) =>
            useSandbox.getState().app?.ranks[unit.id] ?? {
              width: constant("rankWidth", 5),
              maxBonus: constant("maxRankBonus", 2),
            },
        }
      : {}),
    ...(has.leaving ? { leaving: () => useSandbox.getState().app?.leaving ?? [] } : {}),
  });
  provided.push(p.system.id);
  const store = useStore.getState();
  store.session?.refold();
  // A game just set up on the stand-in takes the real system's table, counters and layout.
  const game = useStore.getState().game;
  if (store.role === "host" && game.system === p.system.id && game.turn.round === 0) {
    store.dispatch({ type: "game/system", system: p.system.id });
    if (!game.terrain.length) store.dispatch({ type: "layout/set", layout });
  }
}

/**
 * A package mission as the app uses it: its setup as the sandbox worked it
 * out for the table played on (#43), or, before it has, scaled from the
 * default table's; and its suggestions read from what the sandbox last
 * worked out (nothing until it has).
 */
function packageMission(m: ProvidedMission): Mission {
  const scores = () => useSandbox.getState().app?.scores ?? {};
  return {
    id: m.id,
    name: m.name,
    summary: m.summary,
    ...(m.hand !== undefined ? { hand: m.hand } : {}),
    setup: (table) => {
      const app = useSandbox.getState().app;
      const exact = app?.table?.width === table.width && app.table.depth === table.depth && app.setups[m.id];
      if (exact) return structuredClone(exact);
      const sx = table.width / m.table.width;
      const sy = table.depth / m.table.depth;
      const at = (p: Vec2) => ({ x: p.x * sx, y: p.y * sy });
      return {
        zones: m.setup.zones.map((z) => ({ ...z, points: z.points.map(at) })),
        objectives: m.setup.objectives.map((o) => ({ ...o, position: at(o.position) })),
      };
    },
    scoring: m.scoring.map((rule) => ({
      ...rule,
      suggest: (state, seat) => scores()[`${rule.id}:${state.turn.round}:${seat}`] ?? null,
    })),
    ...(m.deck
      ? {
          deck: m.deck.map((card) => ({
            ...card,
            suggest: (_game, seat) =>
              useSandbox.getState().app?.cards[`${card.id}:${seat}`] ?? { vp: 0, why: card.text },
          })),
        }
      : {}),
  };
}

function stop(why: string) {
  unload();
  sandbox = null;
  sent = null;
  setIntentRouter(null);
  useSandbox.setState({ status: "stopped", error: why, code: {}, rows: {} });
}

/** Bumped when a start is cancelled (the packages changed, or the game screen went), so a start still loading stops itself. */
let generation = 0;

async function start(packages: { hash: string; source: string }[]): Promise<void> {
  const gen = ++generation;
  useSandbox.setState({ status: "starting", error: null, code: {}, rows: {} });
  try {
    const source = (await import("virtual:sandbox-worker")).default;
    if (gen !== generation) return;
    const box = await Sandbox.start(source, stop);
    const loaded = await box.call<Loaded>({ t: "load", packages }, STARTUP_MS).finally(() => {
      // Cancelled while starting: nothing else holds this one, so end its iframe and worker here.
      if (gen !== generation) box.stop();
    });
    if (gen !== generation) return;
    sandbox = box;
    sent = null;
    sync();
    const code: Record<string, string[]> = {};
    for (const p of loaded.packages) {
      if (p.provides) {
        provide(p.provides);
        code[p.provides.system.id] ??= [];
      }
      for (const s of p.systems) {
        code[s] = [...(code[s] ?? []), ...p.procedures, ...p.actions];
        extendSystem(s, p.data);
        registerHooks(s, p.hash, p.hooks);
      }
      hookOwners.push(p.hash);
    }
    useSandbox.setState({
      status: "on",
      code,
      error: loaded.errors.length ? `A rules package didn't load: ${loaded.errors[0]!.error}` : null,
    });
    // While a package changes a system, the sandbox (which has its code) resolves every intent in
    // that game: any rule may now call package code, from data ({ call }) as well as from code.
    setIntentRouter((intent, from, state) => {
      if (!code[systemOf(state).id] || !sandbox) return null;
      const box = sandbox;
      return (seed) => {
        sync();
        return box.call({ t: "resolve", intent, from, seed });
      };
    });
  } catch (e) {
    if (gen === generation) stop(e instanceof Error ? e.message : String(e));
  }
}

/** Keep the sandbox running the game's trusted packages. Mount once. */
export function usePackageSandbox(): void {
  const wanted = useStore((s) => s.game.packages?.packages);
  const waived = useStore((s) => s.packagesWaived);
  const library = useLibrary((s) => s.packages);
  const run = (wanted ?? []).filter((p) => library[p.hash]?.trusted && !waived[p.hash]);
  const key = run.map((p) => p.hash).join();
  useEffect(() => {
    if (!key) return;
    const lib = useLibrary.getState().packages;
    void start(key.split(",").map((hash) => ({ hash, source: lib[hash]!.source })));
    return () => {
      generation++;
      sandbox?.stop();
      unload();
      sandbox = null;
      sent = null;
      setIntentRouter(null);
      useSandbox.setState({ status: "off", error: null, code: {}, rows: {} });
    };
  }, [key]);
  // Every change to the record reaches the worker's replica.
  useEffect(() => useStore.subscribe((s, p) => s.record !== p.record && sync()), []);
}

/** The packages' code actions for a unit, worked out in the sandbox (empty until it answers). */
export function usePackageActions(unit: Unit): ActionRow[] {
  const status = useSandbox((s) => s.status);
  const seq = useStore((s) => s.record.events.at(-1)?.seq ?? 0);
  const has = useSandbox((s) => (s.code[systemOf(useStore.getState().game).id] ?? []).length > 0);
  const key = `${seq}:${unit.id}`;
  const rows = useSandbox((s) => s.rows[key]);
  useEffect(() => {
    if (status !== "on" || !has || rows || !sandbox) return;
    sync();
    sandbox
      .call<ActionRow[]>({ t: "actions", unitId: unit.id, player: unit.owner })
      .then((r) => useSandbox.setState((s) => ({ rows: { [key]: r, ...keep(s.rows, seq) } })))
      .catch(() => {});
  }, [status, has, key, rows, unit.id, unit.owner, seq]);
  return rows ?? [];
}

/** Rows for the current seq only. */
function keep(rows: SandboxState["rows"], seq: number): SandboxState["rows"] {
  return Object.fromEntries(Object.entries(rows).filter(([k]) => k.startsWith(`${seq}:`)));
}
