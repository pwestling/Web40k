/**
 * Development-only performance harness, exposed as `window.openBattlePerf`.
 * Used by scripts/perf.mjs and handy from the console:
 *
 *   await openBattlePerf.setup(2)              // hotseat, both sample armies, twice over
 *   await openBattlePerf.dress(500_000)        // a 500k-triangle sculpt per profile
 *   await openBattlePerf.measure()             // frame times and what the GPU drew
 */
import type { WebGLRenderer } from "three";
import { unitKeys, useAssets } from "../assets/store";
import { processMesh, ready, weld } from "../assets/pipeline";
import { synthMiniature } from "../assets/synth";
import type { ModelAsset } from "../assets/types";
import { useStore } from "../store";
import { spawnIntents } from "../systems/wh40k/deploy";
import { systemOf } from "../core/content/turn";
import { systemModule } from "../systems";

let renderer: WebGLRenderer | null = null;
export function setPerfRenderer(gl: WebGLRenderer) {
  renderer = gl;
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

export const perf = {
  /** Start a hotseat game and deploy both sample armies `copies` times. */
  async setup(copies = 1, system?: string) {
    const store = useStore.getState();
    store.start({ role: "host", mode: "hotseat", name: "Perf", system });
    await frame();
    const sample = systemModule(system).sample;
    for (let c = 0; c < copies; c++) {
      for (const [owner, variant] of [
        ["p1", 0],
        ["p2", 1],
      ] as const) {
        const { game, dispatch } = useStore.getState();
        // Rank-and-flank units deploy as blocks, five wide like the army import's default.
        const ranked = systemOf(game).unitShape.kind === "ranked";
        const units = sample(variant).units.map((u) =>
          ranked ? { ...u, files: Math.min(u.models.length, 5) } : u,
        );
        for (const intent of spawnIntents(game, owner, units, `${owner}-perf${c}`)) dispatch(intent, owner);
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
    const { game, dispatch } = useStore.getState();
    const { addAsset } = useAssets.getState();
    const keys = unitKeys(Object.values(game.models));
    const assets = new Map<string, ModelAsset>();
    keys.forEach((key, i) => {
      // Slightly different sculpts so every profile is its own asset.
      const mesh = synthMiniature(sourceTriangles * (1 + i * 0.01));
      const id = `synth-${sourceTriangles}-${raw ? "raw" : "lod"}-${i}`;
      let asset = processMesh(mesh, { id, name: key, kind: "miniature" });
      if (raw) {
        const welded = weld(mesh);
        welded.positions.forEach((v, j) => (welded.positions[j] = v * asset.stats.unitScale));
        asset = { ...asset, lods: [welded] };
      }
      addAsset(asset);
      assets.set(key, asset);
    });
    for (const unit of Object.values(game.units)) {
      for (const key of unitKeys(unit.modelIds.flatMap((id) => game.models[id] ?? []))) {
        const asset = assets.get(key)!;
        const figure = { asset: asset.id, name: key, yaw: 0, scale: 1 };
        dispatch(
          { type: "unit/figure", id: unit.id, keys: [key], figure, bands: asset.figure?.bands },
          unit.owner,
        );
      }
    }
    await frame();
    return { profiles: keys.length, pipelineMs: [...assets.values()].map((a) => a.stats.ms) };
  },

  /**
   * Replace every terrain piece's boxes with an uploaded-style model:
   * `kinds` distinct sculpts of `sourceTriangles`, scaled to each footprint.
   */
  async terrain(sourceTriangles: number, kinds = 3) {
    await ready;
    const { game, dispatch } = useStore.getState();
    const { addAsset } = useAssets.getState();
    const assets = Array.from({ length: kinds }, (_, i) => {
      const asset = processMesh(synthMiniature(sourceTriangles * (1 + i * 0.01), 25.4 * 4), {
        id: `synth-terrain-${sourceTriangles}-${i}`,
        name: `terrain ${i}`,
        kind: "terrain",
      });
      addAsset(asset);
      return asset;
    });
    game.terrain.forEach((piece, i) => {
      const asset = assets[i % kinds]!;
      const width = asset.bounds.max[0] - asset.bounds.min[0];
      const mesh = { asset: asset.id, name: asset.name, scale: piece.width / width };
      dispatch({ type: "terrain/update", piece: { ...piece, mesh } });
    });
    await frame();
    return { pieces: game.terrain.length, pipelineMs: assets.map((a) => a.stats.ms) };
  },

  /** Take every figure off. */
  undress() {
    const { game, dispatch } = useStore.getState();
    for (const unit of Object.values(game.units)) {
      const keys = unitKeys(unit.modelIds.flatMap((id) => game.models[id] ?? []));
      dispatch({ type: "unit/figure", id: unit.id, keys, figure: null }, unit.owner);
    }
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
