import { useState } from "react";
import type { Player } from "../core";
import { secretsWithPrefix } from "../core/secrets";
import { keepSecret, localSecret, useLocalSecrets } from "../secrets/local";
import { systemModule } from "../systems";
import { useStore } from "../store";
import { useGame } from "./hooks";
import { t } from "../i18n";

const PREFIX = "objective:";

/**
 * Hidden objectives (SystemModule.secretObjectives): a player writes one down
 * and only a commitment reaches the table, so the opponent, the host and
 * spectators see how many are face down, never what they say, until revealed.
 */
export function SecretObjectives({ players }: { players: Player[] }) {
  const game = useGame();
  const name = systemModule(game.system).secretObjectives;
  useLocalSecrets((s) => s.kept);
  const seated = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  if (!name || !seated.length) return null;
  const count = seated.reduce((n, p) => n + secretsWithPrefix(game, p.id, PREFIX).length, 0);
  // A mission with its own card deck has Secret missions instead (Missions.tsx), unless some are written already.
  const deck = systemModule(game.system).missions?.find((m) => m.id === game.mission?.id)?.deck?.length;
  if (deck && !count) return null;
  return (
    <details className="fold secret-objectives">
      <summary>
        {name}
        {count ? ` (${count})` : ""}
      </summary>
      {seated.map((p) => (
        <Objectives key={p.id} player={p} mine={players.some((m) => m.id === p.id)} />
      ))}
    </details>
  );
}

function Objectives({ player, mine }: { player: Player; mine: boolean }) {
  const game = useGame();
  const { dispatch } = useStore();
  const [text, setText] = useState("");
  const all = secretsWithPrefix(game, player.id, PREFIX);
  const hidden = all.filter(([, e]) => !e.revealed).length;
  const add = () => {
    const key = `${PREFIX}${String(all.length).padStart(3, "0")}`;
    const commitment = keepSecret(text.trim());
    dispatch(
      {
        type: "secret/commit",
        player: player.id,
        secrets: [{ key, commitment }],
        label: "a secret objective",
      },
      player.id,
    );
    setText("");
  };
  return (
    <div className="stack-player">
      <span style={{ color: player.color }}>{player.name}</span>{" "}
      {!mine && (
        <span className="muted small">
          {hidden ? t("{n} face down", { n: hidden }) : all.length ? "" : t("none yet")}
        </span>
      )}
      <ul className="objective-list">
        {all.map(([key, e]) => {
          const kept = mine && !e.revealed ? localSecret(e.commitment) : undefined;
          if (e.revealed) return <li key={key}>{String(e.revealed.value)}</li>;
          if (!mine) return null;
          return (
            <li key={key}>
              <span className="muted">{kept ? String(kept.value) : t("(written on another device)")}</span>{" "}
              {kept && (
                <button
                  onClick={() =>
                    dispatch(
                      {
                        type: "secret/reveal",
                        player: player.id,
                        key,
                        value: kept.value,
                        salt: kept.salt,
                        label: "a secret objective",
                      },
                      player.id,
                    )
                  }
                >
                  {t("Reveal")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {mine && (
        <div className="row">
          <input
            value={text}
            placeholder={t("Write one down")}
            aria-label={t("New secret objective for {name}", { name: player.name })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && add()}
          />
          <button disabled={!text.trim()} onClick={add}>
            {t("Keep secret")}
          </button>
        </div>
      )}
    </div>
  );
}
