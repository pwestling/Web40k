import type { TypeCompletion, TypeHover, TypeProblem } from "./checker";

export type TypeRequest =
  | { t: "problems"; source: string }
  | { t: "hover"; source: string; pos: number }
  | { t: "complete"; source: string; pos: number }
  | { t: "detail"; source: string; pos: number; name: string };

/**
 * Talks to the type checker's worker (#43), started on first use. When it
 * can't start (offline before it was ever fetched, say), every answer is
 * empty and the workshop works as before, without types.
 */
let worker: Worker | null = null;
let broken = false;
let next = 1;
const waiting = new Map<number, (v: unknown) => void>();

function start(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./typesWorker.ts", import.meta.url), {
      type: "module",
      name: "workshop-types",
    });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
    waiting.get(e.data.id)?.(e.data.result);
    waiting.delete(e.data.id);
  };
  worker.onerror = () => {
    broken = true;
    worker?.terminate();
    worker = null;
    for (const done of waiting.values()) done(null);
    waiting.clear();
  };
  return worker;
}

function ask<T>(req: TypeRequest): Promise<T | null> {
  const w = start();
  if (!w) return Promise.resolve(null);
  const id = next++;
  return new Promise((resolve) => {
    waiting.set(id, (v) => resolve(v as T | null));
    w.postMessage({ ...req, id });
  });
}

export const types = {
  problems: async (source: string) => (await ask<TypeProblem[]>({ t: "problems", source })) ?? [],
  hover: (source: string, pos: number) => ask<TypeHover>({ t: "hover", source, pos }),
  complete: async (source: string, pos: number) =>
    (await ask<TypeCompletion[]>({ t: "complete", source, pos })) ?? [],
  detail: (source: string, pos: number, name: string) =>
    ask<{ text: string; doc: string }>({ t: "detail", source, pos, name }),
  /** Whether the checker is running (false once it failed to start). */
  available: () => !broken,
};
