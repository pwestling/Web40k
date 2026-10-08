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
import { processMesh, processModel, ready, weld } from "../assets/pipeline";
import { bakePaint } from "../assets/paint";
import { encodeAsset } from "../assets/codec";
import { synthMiniature } from "../assets/synth";
import { BUDGETS, type ModelAsset } from "../assets/types";
import { useStore } from "../store";
import { spawnIntents } from "../systems/wh40k/deploy";
import { systemOf } from "../core/content/turn";
import { systemModule } from "../systems";
import { Sandbox } from "../sandbox/host";
import { stateHash } from "../core/checksum";
import type { ActionRow } from "../sandbox/protocol";
import secondWind from "../../examples/packages/second-wind.js?raw";

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
  async dress(sourceTriangles: number, raw = false, painted = false) {
    await ready;
    const { game, dispatch } = useStore.getState();
    const { addAsset } = useAssets.getState();
    const keys = unitKeys(Object.values(game.models));
    const assets = new Map<string, ModelAsset>();
    // Painted: a 2048 px source texture per sculpt, like a scan's, baked and compressed as an upload is.
    const image = painted ? await paintScheme(2048) : null;
    for (const [i, key] of keys.entries()) {
      // Slightly different sculpts so every profile is its own asset.
      const mesh = synthMiniature(sourceTriangles * (1 + i * 0.01), 25.4, painted);
      const id = `synth-${sourceTriangles}-${raw ? "raw" : painted ? "painted" : "lod"}-${i}`;
      let asset: ModelAsset;
      if (image) {
        const vertices = mesh.positions.length / 3;
        const paint = bakePaint(
          [{ vertices, uvs: mesh.uvs, material: 0 }],
          [{ factor: [1, 1 - i * 0.05, 1, 1], image }],
          BUDGETS.miniature.texture.side,
        );
        asset = await processModel(
          { positions: mesh.positions, indices: mesh.indices, ...paint, sourceTexture: [2048, 2048] },
          { id, name: key, kind: "miniature" },
        );
      } else asset = processMesh(mesh, { id, name: key, kind: "miniature" });
      if (raw) {
        const welded = weld(mesh);
        welded.positions.forEach((v, j) => (welded.positions[j] = v * asset.stats.unitScale));
        asset = { ...asset, lods: [welded] };
      }
      addAsset(asset);
      assets.set(key, asset);
    }
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
    const list = [...assets.values()];
    const sent = await Promise.all(list.map(async (a) => (await encodeAsset(a)).byteLength));
    return {
      profiles: keys.length,
      pipelineMs: list.map((a) => a.stats.ms),
      // What a peer downloads per figure, and of that the texture.
      sendKB: Math.round(sent.reduce((x, y) => x + y, 0) / list.length / 1024),
      textureKB: Math.round(
        list.reduce((x, a) => x + (a.texture?.bytes.byteLength ?? 0), 0) / list.length / 1024,
      ),
    };
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
  /** Roll `count` dice as player one, for the dice tray to stage. */
  roll(count: number, sides = 6) {
    useStore.getState().dispatch({ type: "dice/roll", count, sides }, "p1");
  },

  /**
   * What one small event costs on this table: the reducer and React's
   * synchronous work for it, then the time to the next painted frame.
   */
  async dispatchCost(n = 10) {
    const sync: number[] = [];
    const painted: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      useStore.getState().dispatch({ type: "dice/roll", count: 1, sides: 6 }, "p1");
      sync.push(performance.now() - t);
      await frame();
      painted.push(performance.now() - t);
    }
    const med = (xs: number[]) => +xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(1);
    return { syncMs: med(sync), toFrameMs: med(painted) };
  },

  /**
   * The rules sandbox against perf/scripting-budget.md, on whatever game is
   * set up (an Old World one, for the example package): startup, the first
   * copy of the record, forwarding events, small calls, a package procedure,
   * and the checksum.
   */
  async sandbox(calls = 200) {
    const pct = (xs: number[], p: number) =>
      +[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!.toFixed(2);
    const stats = (xs: number[]) => ({ p50: pct(xs, 0.5), p95: pct(xs, 0.95) });
    const timed = async <T>(f: () => Promise<T>) => {
      const t = performance.now();
      const v = await f();
      return [performance.now() - t, v] as const;
    };

    let t = performance.now();
    const source = (await import("virtual:sandbox-worker")).default;
    const fetchMs = performance.now() - t;
    const [bootMs, box] = await timed(() => Sandbox.start(source, (why) => console.warn(why)));
    const [loadMs] = await timed(() =>
      box.call({ t: "load", packages: [{ hash: "perf", source: secondWind }] }, 5000),
    );

    const { record, game } = useStore.getState();
    // The record minus its last events, so they can be forwarded one at a time.
    const tail = record.events.slice(-Math.min(20, record.events.length));
    const head = { ...record, events: record.events.slice(0, record.events.length - tail.length) };
    t = performance.now();
    const p = box.call({ t: "init", record: head }, 5000);
    const initPostMs = performance.now() - t;
    await p;
    const initMs = performance.now() - t;

    const forward: number[] = [];
    for (const e of tail) forward.push((await timed(() => box.call({ t: "events", events: [e] })))[0]);

    const unit = Object.values(game.units).find((u) => !u.status?.reserves) ?? Object.values(game.units)[0];
    const small: number[] = [];
    for (let i = 0; i < calls && unit; i++)
      small.push(
        (await timed(() => box.call<ActionRow[]>({ t: "actions", unitId: unit.id, player: unit.owner })))[0],
      );
    const resolve: number[] = [];
    for (let i = 0; i < 50 && unit; i++)
      resolve.push(
        (
          await timed(() =>
            box.call({
              t: "resolve",
              intent: { type: "script/start", procedure: "secondWind", args: { unit: unit.id } },
              from: unit.owner,
              seed: i,
            }),
          )
        )[0],
      );
    box.stop();

    const hash: number[] = [];
    for (let i = 0; i < 5; i++) stateHash(game);
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      stateHash(game);
      hash.push(performance.now() - t0);
    }
    return {
      models: Object.values(game.models).filter((m) => !m.destroyed).length,
      events: record.events.length,
      recordKB: Math.round(JSON.stringify(head).length / 1024),
      workerKB: Math.round(source.length / 1024),
      startup: {
        fetchMs: +fetchMs.toFixed(1),
        bootMs: +bootMs.toFixed(1),
        loadMs: +loadMs.toFixed(1),
        initMs: +initMs.toFixed(1),
        initPostMs: +initPostMs.toFixed(1),
      },
      forwardEventMs: stats(forward),
      smallCallMs: stats(small),
      resolveMs: stats(resolve),
      checksumMs: stats(hash),
    };
  },

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

/** A busy painted surface: base colour, camo blotches, and fine edge highlights a downscale has to keep. */
async function paintScheme(side: number): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(side, side);
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f4a6b";
  g.fillRect(0, 0, side, side);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    g.fillStyle = ["#b8862f", "#7a1f1f", "#d9d2c0", "#1b1b1b"][i % 4]!;
    g.beginPath();
    g.ellipse(rand() * side, rand() * side, 10 + rand() * 80, 10 + rand() * 60, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#e8e4d8";
  for (let i = 0; i < 2000; i++) {
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    const x = rand() * side;
    const y = rand() * side;
    g.moveTo(x, y);
    g.lineTo(x + rand() * 30, y + rand() * 30);
    g.stroke();
  }
  return createImageBitmap(c);
}
