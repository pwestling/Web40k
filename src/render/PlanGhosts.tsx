import { useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { baseSizeInches, type GameState } from "../core";
import { t } from "../i18n";
import { usePlan } from "../ui/plan";
import { LABEL_Z } from "./boardLabels";

const fmt = (n: number) => `${Math.round(n * 10) / 10}"`;

/** The centre of a set of points. */
function centre(ps: { x: number; y: number }[]): { x: number; y: number } {
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

/**
 * Your plan for your next turn (#81), on your screen only: a ghost of each
 * planned model where it would go, with a line back to where it stands and
 * how far that is, and a dashed line from each planned shooter (from its
 * ghosts, if it has any) to its target, with the gap between them.
 */
export function PlanGhosts({ game }: { game: GameState }) {
  const moves = usePlan((s) => s.moves);
  const shots = usePlan((s) => s.shots);
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const to of Object.values(moves))
      for (const [id, at] of Object.entries(to)) {
        const m = game.models[id];
        if (!m || m.destroyed) continue;
        pts.push(m.position.x, (m.z ?? 0) + 0.08, m.position.y, at.x, (m.z ?? 0) + 0.08, at.y);
      }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, [game.models, moves]);
  useEffect(() => () => lines.dispose(), [lines]);
  // Where each planned shooter would be, and the gap to its target's nearest model.
  const aims = useMemo(
    () =>
      Object.entries(shots).flatMap(([id, target]) => {
        const unit = game.units[id];
        const foe = game.units[target];
        if (!unit || !foe) return [];
        const from = unit.modelIds
          .map((m) => game.models[m])
          .filter((m) => m && !m.destroyed)
          .map((m) => moves[id]?.[m!.id] ?? m!.position);
        const at = foe.modelIds
          .map((m) => game.models[m])
          .filter((m) => m && !m.destroyed)
          .map((m) => m!.position);
        if (!from.length || !at.length) return [];
        let gap = Infinity;
        for (const a of from) for (const b of at) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
        return [{ id, from: centre(from), to: centre(at), gap }];
      }),
    [game.models, game.units, moves, shots],
  );
  const aimLines = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        aims.flatMap((a) => [a.from.x, 0.12, a.from.y, a.to.x, 0.12, a.to.y]),
        3,
      ),
    );
    return g;
  }, [aims]);
  useEffect(() => () => aimLines.dispose(), [aimLines]);
  const count = Object.keys(moves).length + Object.keys(shots).length;
  useEffect(() => {
    document.body.dataset.planned = String(count);
  }, [count]);
  if (!count) return null;
  return (
    <group renderOrder={9}>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial color="#a5b4fc" transparent opacity={0.55} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={aimLines} raycast={() => null}>
        <lineBasicMaterial color="#f59e0b" transparent opacity={0.7} depthWrite={false} />
      </lineSegments>
      {Object.entries(moves).flatMap(([unitId, to]) => {
        const ids = Object.keys(to).filter((id) => game.models[id] && !game.models[id]!.destroyed);
        if (!ids.length) return [];
        const far = Math.max(
          ...ids.map((id) =>
            Math.hypot(to[id]!.x - game.models[id]!.position.x, to[id]!.y - game.models[id]!.position.y),
          ),
        );
        const mid = centre(ids.map((id) => to[id]!));
        return [
          ...ids.map((id) => {
            const m = game.models[id]!;
            const { width, depth } = baseSizeInches(m.base);
            return (
              <mesh
                key={`${unitId}/${id}`}
                rotation-x={-Math.PI / 2}
                position={[to[id]!.x, (m.z ?? 0) + 0.07, to[id]!.y]}
                raycast={() => null}
              >
                <ringGeometry args={[Math.max(width, depth) / 2 - 0.12, Math.max(width, depth) / 2, 28]} />
                <meshBasicMaterial color="#a5b4fc" transparent opacity={0.8} depthWrite={false} />
              </mesh>
            );
          }),
          <Html
            key={`${unitId}/label`}
            zIndexRange={LABEL_Z}
            position={[mid.x, 0.4, mid.y]}
            center
            className="plan-label"
          >
            {t("Planned move {n}", { n: fmt(far) })}
          </Html>,
        ];
      })}
      {aims.map((a) => (
        <Html
          key={`aim/${a.id}`}
          zIndexRange={LABEL_Z}
          position={[(a.from.x + a.to.x) / 2, 0.4, (a.from.y + a.to.y) / 2]}
          center
          className="plan-label aim"
        >
          {t("Target · {n}", { n: fmt(a.gap) })}
        </Html>
      ))}
    </group>
  );
}
