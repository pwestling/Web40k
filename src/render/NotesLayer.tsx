import { LABEL_Z } from "./boardLabels";
import { Html } from "@react-three/drei";
import { useStore } from "../store";
import { useNotes, type NoteMark } from "../replay/notes";
import { useAnnotating } from "../replay/NotesPanel";
import { Arrow, Area } from "./TalkLayer";

const Y = 0.08;

/** The marks of the notes at the replay's current moment, and of the note being written. */
export function NotesLayer() {
  const annotating = useAnnotating();
  const scrub = useStore((s) => s.scrub);
  const notes = useNotes((s) => s.notes);
  const draft = useNotes((s) => s.draft);
  if (!annotating) return null;
  const shown = [
    ...notes
      .filter((n) => n.seq === scrub && n.id !== draft?.id)
      .flatMap((n) => n.marks.map((m) => ({ m, color: n.color, by: n.by }))),
    ...(draft ? draft.marks.map((m) => ({ m, color: "#fde047", by: "" })) : []),
  ];
  return (
    <group renderOrder={10}>
      {shown.map(({ m, color, by }, i) => (
        <Mark key={i} mark={m} color={color} by={by} />
      ))}
    </group>
  );
}

function Mark({ mark, color, by }: { mark: NoteMark; color: string; by: string }) {
  if (mark.kind === "arrow") return <Arrow from={mark.from} to={mark.to} color={color} opacity={0.95} />;
  if (mark.kind === "area") return <Area at={mark.at} radius={mark.radius} color={color} opacity={0.95} />;
  return (
    <group position={[mark.at.x, Y, mark.at.y]}>
      <mesh position={[0, 1.2, 0]} renderOrder={10}>
        <coneGeometry args={[0.45, 1.6, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={10}>
        <ringGeometry args={[0.5, 0.75, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </mesh>
      {by && (
        <Html zIndexRange={LABEL_Z} position={[0, 2.6, 0]} center className="talk-label">
          <span style={{ borderColor: color }}>{by}</span>
        </Html>
      )}
    </group>
  );
}
