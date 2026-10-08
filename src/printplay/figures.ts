import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { lookGeometry } from "../render/standIns";
import type { RulebookUnit } from "./rulebook";

/**
 * Pictures of a game's stand-in figures (#47), for its rules page and its
 * print-and-play sheets: the same procedural figures the table draws
 * (render/standIns.ts), rendered once each into an image. `upright` is the
 * flat front view a cut-out standee needs; otherwise a three-quarter view on
 * its base, for the page.
 */

/** A figure's height when its unit doesn't give one: as the table would stand it (core/terrain modelHeight). */
export function figureHeight(u: Pick<RulebookUnit, "baseMm" | "height">): number {
  if (u.height) return u.height;
  const w = u.baseMm / 25.4;
  return Math.min(5, 1.1 + (w / 2) * 1.6);
}

let renderer: WebGLRenderer | null = null;
const cache = new Map<string, string>();

/**
 * A PNG data URL of the unit's figure, `px` pixels per inch, in `color`.
 * The image is the figure's width (its base) by its height, plus the base
 * when it's on one.
 */
export function figureImage(
  u: Pick<RulebookUnit, "baseMm" | "height" | "look">,
  color: string,
  opts: { px?: number; upright?: boolean } = {},
): string {
  const px = opts.px ?? 120;
  const upright = !!opts.upright;
  const key = JSON.stringify([u.baseMm, u.height, u.look, color, px, upright]);
  const hit = cache.get(key);
  if (hit) return hit;
  const w = u.baseMm / 25.4;
  const h = figureHeight(u);
  const base = upright ? 0 : 0.12;
  // A little room either side: gear can reach past the base.
  const span = Math.max(w * 1.25, 0.6);
  const tall = h + base + 0.1;
  const width = Math.max(8, Math.round(span * px));
  const height = Math.max(8, Math.round(tall * px));
  renderer ??= new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const geo = lookGeometry(u.look, w, w, h);
  const mat = new MeshStandardMaterial({ color, roughness: 0.7 });
  const fig = new Mesh(geo, mat);
  fig.position.y = base;
  if (!upright) fig.rotation.y = -0.5;
  scene.add(fig);
  let plinth: Mesh | null = null;
  if (base) {
    plinth = new Mesh(
      new CylinderGeometry(w / 2, w / 2, base, 32),
      new MeshStandardMaterial({ color: "#202329", roughness: 0.9 }),
    );
    plinth.position.y = base / 2;
    scene.add(plinth);
  }
  // Straight on for a standee (exact size: the image is the figure); a touch from above for the page.
  const camera = new OrthographicCamera(-span / 2, span / 2, tall / 2, -tall / 2, -50, 50);
  if (upright) {
    camera.position.set(0, tall / 2, 10);
    camera.lookAt(0, tall / 2, 0);
  } else {
    camera.position.set(0, tall / 2 + 3, 10);
    camera.lookAt(0, tall / 2, 0);
    // Looking down a little shows the base's top: give it room.
    camera.top = tall * 0.56;
    camera.bottom = -tall * 0.56;
    camera.left = -span * 0.56;
    camera.right = span * 0.56;
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  geo.dispose();
  mat.dispose();
  plinth?.geometry.dispose();
  (plinth?.material as MeshStandardMaterial | undefined)?.dispose();
  cache.set(key, url);
  return url;
}
