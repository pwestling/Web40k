import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { baseSizeInches, type GameState } from "../core";
import { useTalk } from "../talk/talk";

/** A hand not heard from for this long has gone (a dropped message, a closed tab). */
const STALE_MS = 1500;

/**
 * Another player's models in hand (PX E1): while Ana drags, Ben sees where
 * they'd go now, as discs in her colour with a line back to where each
 * stands. Nothing here is in the log; the move lands as ever when she lets go.
 */
export function DragPreview({ game }: { game: GameState }) {
  const drags = useTalk((s) => s.drags);
  const [now, setNow] = useState(() => Date.now());
  const any = Object.keys(drags).length > 0;
  useEffect(() => {
    if (!any) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [any]);
  const live = Object.entries(drags).filter(([, d]) => now - d.at < STALE_MS);
  // How many hands are shown, for the browser checks.
  const count = live.length;
  useEffect(() => {
    document.body.dataset.peerHands = String(count);
  }, [count]);
  return (
    <group renderOrder={9}>
      {live.map(([by, d]) => (
        <Hand key={by} game={game} color={game.players[by]?.color ?? "#e5e7eb"} models={d.models} />
      ))}
    </group>
  );
}

function Hand({
  game,
  color,
  models,
}: {
  game: GameState;
  color: string;
  models: Record<string, { x: number; y: number }>;
}) {
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const [id, to] of Object.entries(models)) {
      const m = game.models[id];
      if (!m) continue;
      pts.push(m.position.x, (m.z ?? 0) + 0.07, m.position.y, to.x, (m.z ?? 0) + 0.07, to.y);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, [game.models, models]);
  useEffect(() => () => lines.dispose(), [lines]);
  return (
    <>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
      </lineSegments>
      {Object.entries(models).map(([id, at]) => {
        const m = game.models[id];
        if (!m) return null;
        const { width, depth } = baseSizeInches(m.base);
        return (
          <mesh
            key={id}
            rotation-x={-Math.PI / 2}
            position={[at.x, (m.z ?? 0) + 0.06, at.y]}
            raycast={() => null}
          >
            <circleGeometry args={[Math.max(width, depth) / 2, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}
