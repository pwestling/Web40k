import { useState } from "react";
import { listSystems } from "../core/content";
import { FRONT, systemLabel } from "./systemLabels";

/** Where a game's army lists come from, in plain steps. */
const LISTS: Record<string, string[]> = {
  "forty-k-11": [
    "Build your list in New Recruit or BattleScribe.",
    "Save it as a file: New Recruit exports JSON, BattleScribe saves .ros or .rosz. All three read in.",
    "In a game, before the battle starts, press Import army list in the left panel and pick the file.",
    "Check the summary: bases are guessed from the unit, and you can change any of them. Then deploy.",
  ],
  "fsd-1.7": [
    "There is no list app for this one yet: start from Sample army, or a rules package that brings units.",
    "Any BattleScribe-style file (.ros, .rosz or New Recruit JSON) with model profiles also reads in.",
    "Stats the list leaves out are asked for on the import summary.",
  ],
  "tow-hand": [
    "Build your list in New Recruit or BattleScribe.",
    "Export it as JSON from New Recruit, or as .rosz from BattleScribe.",
    "In a game, press Import army list in the left panel and pick the file.",
    "Each regiment comes in as a block. Set its frontage (models in the front rank) on the summary.",
    "Lists often leave stats out: the summary shows them in yellow for you to fill in. Everyone sees what you typed.",
  ],
  "conquest-hand": [
    "Build your list in New Recruit (or BattleScribe, where its data is available).",
    "Export it as JSON or .rosz, then press Import army list in the left panel.",
    "Each regiment comes in as a block of stands. Fill in any stats the summary marks as missing.",
  ],
};

/**
 * "Bring your army" (front door): how to get your own list, figures and rules
 * onto the table, for each game. Nothing ships with the app but sample armies.
 */
export function ArmyGuide({ system, onClose }: { system: string; onClose: () => void }) {
  const games = listSystems().filter((s) => LISTS[s.id]);
  const [at, setAt] = useState(LISTS[system] ? system : (games[0]?.id ?? ""));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel modal guide"
        role="dialog"
        aria-label="Bring your army"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>Bring your army</h2>
          <button className="quiet" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tabs" role="tablist">
          {games.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === at}
              className={g.id === at ? "on" : ""}
              onClick={() => setAt(g.id)}
            >
              {systemLabel(g.id, g.name)}
            </button>
          ))}
        </div>
        <h3>Your list</h3>
        <ol>
          {(LISTS[at] ?? []).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
        <p className="muted small">
          Your list stays with you: it goes to the people in your game and nowhere else. Open Battle comes
          with no armies but its made-up samples.
        </p>
        <h3>Your figures</h3>
        <ol>
          <li>
            Any 3D model file works: .glb, .gltf, .stl, .obj or .ply (a scan, or the file you printed from).
          </li>
          <li>Drag the file onto a unit on the table, or select the unit and use Figures on its card.</li>
          <li>One figure for the whole unit, or one per kind of model. Everyone in the game sees them.</li>
        </ol>
        <h3>Rules packages</h3>
        <p>
          A rules package adds a game, or more {FRONT[at]?.army ?? "units"} and rules to one, as a single
          file. Add it under Rules packages on the start screen. Everyone in a game checks they have the same
          version, and a package's code only runs once you have said yes to it.
        </p>
      </div>
    </div>
  );
}
