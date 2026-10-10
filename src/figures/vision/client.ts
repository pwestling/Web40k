import type { MatchRequest, MatchResponse } from "./types";

/** Run one photo match in its own worker; the worker goes when the answer comes. */
export function matchFromPhotos(request: MatchRequest, signal?: AbortSignal): Promise<MatchResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const done = (r: MatchResponse) => {
      worker.terminate();
      resolve(r);
    };
    worker.onmessage = (e: MessageEvent<MatchResponse>) => done(e.data);
    worker.onerror = (e) => done({ ok: false, code: "other", detail: e.message });
    signal?.addEventListener("abort", () => done({ ok: false, code: "other", detail: "aborted" }));
    worker.postMessage(request);
  });
}
