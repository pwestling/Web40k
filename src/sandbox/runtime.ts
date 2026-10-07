import { useEffect } from "react";
import { create } from "zustand";
import type { GameRecord, Unit } from "../core";
import { systemOf } from "../core/content/turn";
import { setIntentRouter } from "../net/session";
import { useLibrary } from "../packages/library";
import { useStore } from "../store";
import { Sandbox, STARTUP_MS } from "./host";
import type { ActionRow, Loaded } from "./protocol";

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
}

export const useSandbox = create<SandboxState>(() => ({ status: "off", error: null, code: {}, rows: {} }));

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
}

function stop(why: string) {
  sandbox = null;
  sent = null;
  setIntentRouter(null);
  useSandbox.setState({ status: "stopped", error: why, code: {}, rows: {} });
}

async function start(packages: { hash: string; source: string }[]): Promise<void> {
  useSandbox.setState({ status: "starting", error: null, code: {}, rows: {} });
  try {
    const source = (await import("virtual:sandbox-worker")).default;
    const box = await Sandbox.start(source, stop);
    const loaded = await box.call<Loaded>({ t: "load", packages }, STARTUP_MS);
    sandbox = box;
    sent = null;
    sync();
    const code: Record<string, string[]> = {};
    for (const p of loaded.packages)
      for (const s of p.systems) code[s] = [...(code[s] ?? []), ...p.procedures, ...p.actions];
    useSandbox.setState({
      status: "on",
      code,
      error: loaded.errors.length ? `A rules package didn't load: ${loaded.errors[0]!.error}` : null,
    });
    setIntentRouter((intent, from, state) => {
      const mine = code[systemOf(state).id] ?? [];
      const procedure =
        intent.type === "script/start"
          ? intent.procedure
          : intent.type === "script/answer"
            ? state.script?.procedure
            : undefined;
      if (!procedure || !mine.includes(procedure) || !sandbox) return null;
      const box = sandbox;
      return (seed) => {
        sync();
        return box.call({ t: "resolve", intent, from, seed });
      };
    });
  } catch (e) {
    stop(e instanceof Error ? e.message : String(e));
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
      sandbox?.stop();
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
