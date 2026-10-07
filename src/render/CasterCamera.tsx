import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { CASTER_FRESH_MS, followed, useBroadcast } from "../broadcast/broadcast";
import { useStore } from "../store";
import { currentCaster, sendCamera, useTalk } from "../talk/talk";

const SEND_MS = 200;
const HEARTBEAT_MS = 2000;

const goal = new Vector3();

type Controls = { target: Vector3; object: { position: Vector3 }; update: () => void };

/**
 * Broadcast mode's shared camera. A commentator's view goes out a few times a
 * second (and a heartbeat while it is still); anyone following eases their own
 * camera to it. Following stops the moment the viewer drags the view.
 */
export function CasterCamera() {
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const casting = useBroadcast((s) => s.casting);
  const last = useRef({ at: 0, key: "" });

  // Stop commentating: tell the audience, so nobody keeps following a frozen view.
  useEffect(() => {
    if (!casting) return;
    return () => sendCamera(null);
  }, [casting]);

  // Grabbing the view yourself stops following.
  useEffect(() => {
    const c = controls as unknown as { addEventListener?: (e: string, f: () => void) => void } | null;
    if (!c?.addEventListener) return;
    const stop = () => {
      if (useBroadcast.getState().follow && followed.active) useBroadcast.setState({ follow: false });
    };
    c.addEventListener("start", stop);
    return () =>
      (c as unknown as { removeEventListener: (e: string, f: () => void) => void }).removeEventListener(
        "start",
        stop,
      );
  }, [controls]);

  useFrame((_, dt) => {
    if (!controls) return;
    const now = performance.now();
    if (casting) {
      followed.active = false;
      const t = controls.target;
      const p = controls.object.position;
      const r = (n: number) => Math.round(n * 100) / 100;
      const cam = {
        target: [r(t.x), r(t.y), r(t.z)] as [number, number, number],
        position: [r(p.x), r(p.y), r(p.z)] as [number, number, number],
      };
      const key = JSON.stringify(cam);
      if (now - last.current.at > (key === last.current.key ? HEARTBEAT_MS : SEND_MS)) {
        last.current = { at: now, key };
        sendCamera(cam);
      }
      return;
    }
    const caster = currentCaster(useTalk.getState().casters);
    followed.active = useBroadcast.getState().follow && !!caster && Date.now() - caster.at < CASTER_FRESH_MS;
    if (!followed.active || !caster || useStore.getState().view !== "3d") return;
    // Ease toward the commentator's view: smooth between their few updates a second.
    const k = Math.min(1, dt * 6);
    controls.target.lerp(goal.fromArray(caster.target), k);
    controls.object.position.lerp(goal.fromArray(caster.position), k);
    controls.update();
  });
  return null;
}
