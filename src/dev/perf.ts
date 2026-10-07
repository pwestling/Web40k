/**
 * Development-only performance harness, exposed as `window.openBattlePerf`.
 * Used by scripts/perf.mjs and handy from the console:
 *
 *   await openBattlePerf.setup(2)              // hotseat, both sample armies, twice over
 *   await openBattlePerf.dress(500_000)        // a 500k-triangle sculpt per profile
 *   await openBattlePerf.measure()             // frame times and what the GPU drew
 */
import type { WebGLRenderer } from "three";
import { bindingKey, useAssets } from "../assets/store";
import { processMesh, ready, weld } from "../assets/pipeline";
import { synthMiniature } from "../assets/synth";
import type { ModelAsset } from "../assets/types";
import { useStore } from "../store";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";

let renderer: WebGLRenderer | null = null;
export function setPerfRenderer(gl: WebGLRenderer) {
  renderer = gl;
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

export const perf = {
  /** Start a hotseat game and deploy both sample armies `copies` times. */
  async setup(copies = 1) {
    const store = useStore.getState();
    store.start({ role: "host", mode: "hotseat", name: "Perf" });
    await frame();
    for (let c = 0; c < copies; c++) {
      for (const [owner, variant] of [
        ["p1", 0],
        ["p2", 1],
      ] as const) {
        const { game, dispatch } = useStore.getState();
        const roster = sampleRoster(variant);
        for (const intent of spawnIntents(game, owner, roster.units, `${owner}-perf${c}`))
          dispatch(intent, owner);
      }
    }
    await frame();
    return Object.values(useStore.getState().game.models).filter((m) => !m.destroyed).length;
  },

  /**
   * Give every profile on the table its own synthetic sculpt of
   * `sourceTriangles`. With `raw`, skip the pipeline and draw the sculpt at
   * full detail, to see what the pipeline saves.
   */
  async dress(sourceTriangles: number, raw = false) {
    await ready;
    const { game } = useStore.getState();
    const { addAsset, setBinding } = useAssets.getState();
    const keys = [...new Set(Object.values(game.models).map(bindingKey))];
    const times: number[] = [];
    keys.forEach((key, i) => {
      // Slightly different sculpts so every profile is its own asset.
      const mesh = synthMiniature(sourceTriangles * (1 + i * 0.01));
      const id = `synth-${sourceTriangles}-${raw ? "raw" : "lod"}-${i}`;
      let asset: ModelAsset;
      if (raw) {
        const welded = weld(mesh);
        const full = processMesh(mesh, { id, name: key, kind: "miniature" });
        const scale = full.stats.unitScale;
        welded.positions.forEach((v, j) => (welded.positions[j] = v * scale));
        asset = { ...full, lods: [welded] };
      } else {
        asset = processMesh(mesh, { id, name: key, kind: "miniature" });
      }
      times.push(asset.stats.ms);
      addAsset(asset);
      setBinding(key, { asset: id, yaw: 0, scale: 1 });
    });
    await frame();
    return { profiles: keys.length, pipelineMs: times };
  },

  /** Clear every figure binding. */
  undress() {
    const { bindings, setBinding } = useAssets.getState();
    for (const key of Object.keys(bindings)) setBinding(key, null);
  },

  /** Frame times over `frames` frames, and the last frame's draw stats. */
  async measure(frames = 120, warmup = 10) {
    for (let i = 0; i < warmup; i++) await frame();
    const times: number[] = [];
    let last = await frame();
    for (let i = 0; i < frames; i++) {
      const now = await frame();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const info = renderer?.info;
    return {
      avgMs: +avg.toFixed(2),
      p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(2),
      fps: +(1000 / avg).toFixed(1),
      triangles: info?.render.triangles,
      calls: info?.render.calls,
      geometries: info?.memory.geometries,
      models: Object.values(useStore.getState().game.models).filter((m) => !m.destroyed).length,
    };
  },
};
