import { useEffect } from "react";
import { DEFAULT_SYSTEM, type GamePackages, type GameState, type PackageRef } from "../core";
import { useLibrary, type StoredPackage } from "../packages/library";
import { useStore } from "../store";
import { refOf } from "../ui/Packages";
import { APP_BUILD } from "../version";
import type { CampaignBook } from "./book";

/**
 * A book's campaign rules (UX 237): the packages its games play with, which
 * the book remembers once their hooks have run in one of its games. Playing
 * for the book turns them on, or offers to.
 */

/** The book's rules this game doesn't have on, with this device's copy of each (if it has one). */
export function rulesOff(
  book: CampaignBook,
  game: GameState,
  library: Record<string, StoredPackage>,
): { ref: PackageRef; stored?: StoredPackage }[] {
  const on = game.packages?.packages ?? [];
  const all = Object.values(library);
  return (book.rules ?? [])
    .filter((r) => !on.some((p) => p.id === r.id))
    .map((ref) => ({
      ref,
      stored: all.find((p) => p.hash === ref.hash) ?? all.find((p) => p.manifest.id === ref.id),
    }));
}

/**
 * Turn packages on for this game: straight away before the battle (or in
 * hotseat), else as a proposal for the other players to agree to.
 */
export function turnOnRules(game: GameState, packages: StoredPackage[]): void {
  const { dispatch, mode, role } = useStore.getState();
  if (!packages.length || (role !== "host" && mode !== "hotseat")) return;
  const on = game.packages?.packages ?? [];
  const next = [...on.filter((p) => !packages.some((x) => x.manifest.id === p.id)), ...packages.map(refOf)];
  if (game.turn.round > 0 && mode !== "hotseat") {
    dispatch({ type: "packages/propose", packages: next });
    return;
  }
  const event: GamePackages = {
    app: APP_BUILD,
    system: { id: game.system ?? DEFAULT_SYSTEM, builtIn: true },
    packages: next,
  };
  if (game.turn.round > 0)
    event.agreed = Object.values(game.players)
      .filter((p) => p.seat !== undefined)
      .map((p) => p.id);
  dispatch({ type: "game/packages", ...event });
}

/** "Scar Test plays with Battle Scars", and a way to turn them on here. */
export function CampaignRulesLine({ book, game }: { book: CampaignBook; game: GameState }) {
  const library = useLibrary((s) => s.packages);
  const { role, mode } = useStore();
  useEffect(() => void useLibrary.getState().load(), []);
  const rules = book.rules ?? [];
  if (!rules.length) return null;
  const off = rulesOff(book, game, library);
  const have = off.flatMap((o) => (o.stored ? [o.stored] : []));
  const missing = off.filter((o) => !o.stored);
  const choose = role === "host" || mode === "hotseat";
  return (
    <p className="muted small">
      {book.name} plays with {rules.map((r) => r.name).join(", ")}.
      {have.length > 0 &&
        (choose ? (
          <>
            {" "}
            <button className="small" onClick={() => turnOnRules(game, have)}>
              Turn on {have.map((p) => p.manifest.name).join(", ")}
            </button>
          </>
        ) : (
          ` The host can turn on ${have.map((p) => p.manifest.name).join(", ")}.`
        ))}
      {missing.length > 0 &&
        ` This device doesn't have ${missing.map((o) => o.ref.name).join(", ")}: load it in Game settings.`}
    </p>
  );
}
