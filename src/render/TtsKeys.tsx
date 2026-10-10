import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vector3 } from "three";
import { useStore } from "../store";
import { useTtsControls } from "../ui/ttsControls";

/** Keys that are typing, not playing: a text box or a list has them. */
function typing(e: KeyboardEvent): boolean {
  const el = e.target;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Focus on the table itself (nothing, or the canvas): Tab measures there instead of moving between buttons. */
function onTable(): boolean {
  const el = document.activeElement;
  return !el || el === document.body || el instanceof HTMLCanvasElement;
}

const PAN = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] } as const;

function panKey(e: KeyboardEvent): keyof typeof PAN | null {
  const k = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : "";
  return k in PAN ? (k as keyof typeof PAN) : null;
}

/**
 * TTS controls (PX TTS reflexes): WASD slides the camera across the table, and holding Tab measures until
 * it is let go, as in Tabletop Simulator. Only while the player has TTS controls on.
 */
export function TtsKeys() {
  const on = useTtsControls((s) => s.on);
  const held = useRef(new Set<keyof typeof PAN>());
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    object: { position: Vector3 };
    update: () => void;
  } | null;

  useEffect(() => {
    if (!on) return;
    const keys = held.current;
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      // By where the key sits, so an AZERTY keyboard's ZQSD does it too.
      const pan = panKey(e);
      if (pan) keys.add(pan);
      if (e.key === "Tab" && onTable()) {
        e.preventDefault();
        const s = useStore.getState();
        if (!e.repeat && s.role !== "spectator" && s.scrub === null) s.set({ measuring: true });
      }
    };
    const up = (e: KeyboardEvent) => {
      const pan = panKey(e);
      if (pan) keys.delete(pan);
      if (e.key === "Tab" && useStore.getState().measuring) useStore.getState().set({ measuring: false });
    };
    const clear = () => keys.clear();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", clear);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", clear);
      keys.clear();
    };
  }, [on]);

  useFrame((_, dt) => {
    const keys = held.current;
    if (!on || !controls || !keys.size || useStore.getState().view === "eye") return;
    let ax = 0;
    let ay = 0;
    for (const k of keys) {
      ax += PAN[k][0];
      ay += PAN[k][1];
    }
    if (!ax && !ay) return;
    // Up the screen is away from the camera; faster the further out it is.
    const fx = controls.target.x - controls.object.position.x;
    const fz = controls.target.z - controls.object.position.z;
    const len = Math.hypot(fx, fz);
    const [ux, uz] = len > 1e-6 ? [fx / len, fz / len] : [0, -1];
    const speed = Math.max(8, controls.object.position.distanceTo(controls.target)) * 0.9 * Math.min(dt, 0.1);
    const mx = (ux * ay - uz * ax) * speed;
    const mz = (uz * ay + ux * ax) * speed;
    const { target, object } = controls;
    target.set(target.x + mx, target.y, target.z + mz);
    object.position.set(object.position.x + mx, object.position.y, object.position.z + mz);
    controls.update();
  });
  return null;
}
