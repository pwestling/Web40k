import { create } from "zustand";
import { useLibrary } from "../packages/library";
import { useStore } from "../store";
import { APP_BUILD } from "../version";
import { bundleReplay, type ReplayFile } from "./replayFile";

/**
 * "Report a problem" (playtest kit, roadmap #21): one file with everything
 * needed to see what went wrong. It is a replay file, so the replay viewer
 * opens it and steps to the moment of the report, plus a `report` section:
 * the app build, the rules packages, the latest checksums, recent console
 * errors and the state of the connection. Nothing is sent anywhere: the
 * player downloads it and passes it on.
 */

export interface ProblemReport {
  at: string;
  build: string;
  /** What went wrong, when a crash made the report. */
  error?: { message: string; stack?: string; component?: string };
  /** The event the game had reached: the replay viewer opens here. */
  seq: number;
  role: string | null;
  mode: string | null;
  system: string | null;
  packages: { name: string; version: string; hash: string; here: boolean }[];
  checks: { seq: number; host?: number; mine?: number }[];
  net: unknown;
  errors: Logged[];
  userAgent: string;
  screen: string;
}

export type ReportFile = ReplayFile & { report: ProblemReport };

interface Logged {
  at: string;
  kind: "error" | "warn" | "uncaught" | "rejection";
  text: string;
}

const KEEP = 60;
const logged: Logged[] = [];
const text = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
function keep(kind: Logged["kind"], parts: unknown[]): void {
  logged.push({ at: new Date().toISOString(), kind, text: parts.map(text).join(" ").slice(0, 2000) });
  if (logged.length > KEEP) logged.shift();
}

let watching = false;
/** Keep the latest console errors and warnings, and anything uncaught, for a report. */
export function watchErrors(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  for (const kind of ["error", "warn"] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => {
      keep(kind, args);
      original(...args);
    };
  }
  addEventListener("error", (e) => keep("uncaught", [e.error ?? e.message]));
  addEventListener("unhandledrejection", (e) => keep("rejection", [e.reason]));
}

/** Each peer connection's state, round trip and route (direct, through STUN, or relayed by TURN). */
async function netStats(): Promise<unknown> {
  const { session, net, mode, roomId } = useStore.getState();
  if (!session) return { mode };
  const peers: Record<string, unknown> = {};
  for (const [id, pc] of Object.entries(session.connections())) {
    const out: Record<string, unknown> = { state: pc.connectionState, ice: pc.iceConnectionState };
    try {
      const stats = await pc.getStats();
      const all = new Map<string, Record<string, unknown>>();
      stats.forEach((s: Record<string, unknown>) => all.set(s.id as string, s));
      for (const s of all.values())
        if (s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded") {
          const local = all.get(s.localCandidateId as string);
          const remote = all.get(s.remoteCandidateId as string);
          out.rttMs =
            typeof s.currentRoundTripTime === "number"
              ? Math.round(s.currentRoundTripTime * 1000)
              : undefined;
          out.route = `${local?.candidateType ?? "?"} → ${remote?.candidateType ?? "?"}`;
          out.protocol = local?.protocol;
          out.bytesSent = s.bytesSent;
          out.bytesReceived = s.bytesReceived;
        }
    } catch {
      // Stats are a nicety: a closed connection has none.
    }
    peers[id] = out;
  }
  return { mode, roomId, self: session.selfId, status: net, peers };
}

/** The whole report as a replay file. */
export async function buildReport(error?: ProblemReport["error"]): Promise<ReportFile> {
  const { record, game, role, mode, session } = useStore.getState();
  const library = useLibrary.getState().packages;
  const report: ProblemReport = {
    at: new Date().toISOString(),
    build: APP_BUILD,
    ...(error ? { error } : {}),
    seq: record.events.at(-1)?.seq ?? record.initial.seq,
    role,
    mode,
    system: game.system ?? null,
    packages: (game.packages?.packages ?? []).map((p) => ({
      name: p.name,
      version: p.version,
      hash: p.hash,
      here: !!library[p.hash],
    })),
    checks: session?.checkHistory ?? [],
    net: await netStats(),
    errors: [...logged],
    userAgent: navigator.userAgent,
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
  };
  let file: ReplayFile;
  try {
    file = await bundleReplay(record);
  } catch {
    // Figures that won't pack must not cost the report: the bare record still replays.
    file = { ...record };
  }
  return { ...file, report };
}

/** Download a report (or any JSON) as a file. */
export function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

/** Build the report and download it. */
export async function reportProblem(error?: ProblemReport["error"]): Promise<void> {
  download(`open-battle-report-${stamp()}.json`, await buildReport(error));
}

export { stamp };

/** A problem report open in the replay viewer: what it says, shown over the table. */
export const useOpenReport = create<{ report: ProblemReport | null }>(() => ({ report: null }));
