import { DEFAULT_SYSTEM, sides } from "../core";
import { systemOf } from "../core/content/turn";
import { language, t } from "../i18n";
import { NET_PARAMS } from "../net/config";
import { postTable } from "../opentables/board";
import { liveInfo } from "../opentables/live";
import { newPostId } from "../opentables/post";
import { characterName, levelName, useSolo } from "../bot/solo";
import { useStore } from "../store";
import { deploySamples } from "../teach/setup";
import { presetMission } from "../ui/demo";
import { FRONT } from "../ui/systemLabels";

/**
 * The exhibition table (#64): so Live now is never empty, a screen opened at
 * `?exhibition=1` hosts the computer playing itself, Sharp against Sharp, in
 * a room on Open tables that anyone can watch. When a game ends it stays up a
 * while, then the next game system takes the table. Opening that link is the
 * volunteer's choice to post; nothing else posts on its own.
 * `&systems=a,b` picks the systems to rotate through.
 */

const params = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export const EXHIBITION = params().get("exhibition") === "1";

/** How long a finished game stays on the table before the next one. */
const LINGER_MS = 45_000;
const NEXT_KEY = "open-battle:exhibition-next";

function rotation(): string[] {
  const asked =
    params()
      .get("systems")
      ?.split(",")
      .filter((id) => FRONT[id]) ?? [];
  return asked.length ? asked : Object.keys(FRONT);
}

/** This screen hosts the next exhibition game. */
export function startExhibition(): void {
  const systems = rotation();
  let i = 0;
  try {
    i = Number(localStorage.getItem(NEXT_KEY)) || 0;
    localStorage.setItem(NEXT_KEY, String((i + 1) % systems.length));
  } catch {
    // Without storage it always starts on the first.
  }
  const system = systems[i % systems.length] ?? DEFAULT_SYSTEM;
  const roomId = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  useStore
    .getState()
    .start({ role: "host", mode: "online", roomId, name: t("Exhibition"), system, exhibition: true });
  let tries = 0;
  const setUp = () => {
    const { game, session } = useStore.getState();
    if (!session || sides(game).length < 2 || (game.system ?? DEFAULT_SYSTEM) !== system) {
      if (tries++ < 200) setTimeout(setUp, 100);
      return;
    }
    const { dispatch } = useStore.getState();
    // Two characters, both at their sharpest.
    const names = [characterName("sharp"), characterName("steady")];
    for (const p of Object.values(game.players))
      if (p.seat !== undefined)
        dispatch(
          {
            type: "player/rename",
            player: p.id,
            name: t("{name} ({level})", { name: names[p.seat] ?? names[0]!, level: levelName("sharp") }),
          },
          p.id,
        );
    presetMission();
    deploySamples(() => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6));
    dispatch({ type: "turn/next" });
    useSolo.setState({
      level: "sharp",
      seat: 0,
      both: true,
      session,
      policy: null,
      seed: Date.now() % 2 ** 31,
      paused: false,
      why: null,
      deadline: null,
    });
    useStore.setState({ director: true });
    void post(system, roomId);
    whenOver();
  };
  setUp();
}

function post(system: string, roomId: string): Promise<boolean> {
  const now = Date.now();
  return postTable({
    id: newPostId(),
    name: t("The computer"),
    system,
    game: FRONT[system]?.title ?? system,
    size: "",
    start: null,
    lang: language().split("-")[0] ?? "en",
    kind: "live",
    voice: false,
    seats: 0,
    note: t("The computer plays itself, Sharp against Sharp. A new game starts when this one ends."),
    join: roomId,
    expires: now + 4 * 3600_000,
    watch: true,
    live: liveInfo(useStore.getState().game, 0),
  });
}

/** Once the battle is over and has been seen, the next system takes the table (a fresh page). */
function whenOver(): void {
  const off = useStore.subscribe((s) => {
    const rounds = Number(systemOf(s.game).turn.rounds) || Infinity;
    if (s.game.turn.round <= rounds) return;
    off();
    setTimeout(() => {
      const q = new URLSearchParams({ exhibition: "1" });
      const here = params();
      for (const k of ["systems", ...NET_PARAMS]) if (here.get(k)) q.set(k, here.get(k)!);
      window.location.assign(`${location.pathname}?${q}`);
    }, LINGER_MS);
  });
}
