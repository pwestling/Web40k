import { shot } from "../render/focus";
import { sideName, sidePlayers, sides } from "../core";
import { t } from "../i18n";
import { displayName } from "../i18n/names";
import { useStore } from "../store";
import { audioOut } from "../ui/sound";
import { voiceStreams } from "../voice/voice";
import { everyFrame, tableCanvas } from "./capture";
import { paintOverlays } from "./paint";
import { withDuration } from "./webmDuration";

/**
 * Clips (#46): the table, with what's over it (the dice tray and its
 * banners, moment cards, name plates), recorded to WebM. Each frame the table
 * is copied into a canvas of our own right after it renders and the page's
 * overlays are painted on top (paint.ts); that canvas's captureStream feeds a
 * MediaRecorder. Game sounds and table talk can go in the clip's sound.
 */

interface ClipSound {
  /** Dice, bells and the room. */
  sounds: boolean;
  /** Table talk: this device's mic and each player's voice. */
  voice: boolean;
}

/** A clip's frame: 16:9 for video sites, square for feeds, 9:16 for phone stories (UX 337, PX share 6). */
export type ClipShape = "wide" | "square" | "tall";
const SIZES: Record<ClipShape, { width: number; height: number }> = {
  wide: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  tall: { width: 1080, height: 1920 },
};
const FPS = 30;
/** The end frame (the result and where to play) stays this long (PX share 5). */
const END_MS = 1500;

/** What the clip ends on. */
interface ClipEnding {
  title: string;
  line?: string;
  url: string;
}

/** The shape that suits this screen: tall on a phone held upright, else wide. */
export function defaultShape(): ClipShape {
  return innerHeight > innerWidth * 1.2 ? "tall" : "wide";
}

/** Whether this browser can record clips. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    !!mimeType()
  );
}

function mimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

export interface Recording {
  /** Stop and get the clip. */
  stop(): Promise<Blob>;
  /** Stop and throw it away. */
  cancel(): void;
}

export function startClip(sound: ClipSound, shape: ClipShape, ending: () => ClipEnding): Recording | null {
  const table = tableCanvas();
  const type = mimeType();
  if (!table || !type) return null;
  const { width, height } = SIZES[shape];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const stopFrames = everyFrame((src) => {
    // The page may have scrolled or resized since: measure each frame.
    const r = src.getBoundingClientRect();
    // Until the canvas's pixels match its box (it is being resized), its frame is drawn small in a corner: skip it.
    if (!src.width || !r.width || Math.abs(src.width / src.height - r.width / r.height) > 0.02) return;
    // Cover the clip's frame with the table, keeping its middle; the overlays line up the same way.
    // A square or tall clip of a wide screen would crop the table's ends away (UX 356): it goes
    // part way between covering and fitting, with dark bands for the caption and dice.
    const cover = Math.max(width / r.width, height / r.height);
    const fit = Math.min(width / r.width, height / r.height);
    const narrow = Math.abs(width / height - r.width / r.height) > 0.2;
    // A tall clip of a wide screen fits the whole table across (UX 367: edge units were cut) and
    // uses the bands above and below: the score and dice on top, the caption underneath.
    const tall = narrow && height / width > 1.3 && r.width >= r.height;
    const k = tall ? fit : narrow ? fit + (cover - fit) * 0.45 : cover;
    const dx = (width - r.width * k) / 2;
    const dy = (height - r.height * k) / 2;
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src, dx, dy, r.width * k, r.height * k);
    if (tall) drawScore(ctx, width, dy);
    paintOverlays(
      ctx,
      { left: r.left - dx / k, top: r.top - dy / k, scale: k },
      document,
      // Cropped from a screen of another shape, the tray would sit squeezed in a corner (UX 55).
      narrow ? { width, height, below: dy + r.height * k, ...(tall ? { above: dy } : {}) } : undefined,
    );
  });

  const video = canvas.captureStream(FPS);
  const tracks = [...video.getVideoTracks()];
  // The sound: the app's own bus, and voices, mixed into one track.
  const out = sound.sounds || sound.voice ? audioOut() : null;
  let mixed: MediaStreamAudioDestinationNode | null = null;
  const sources: AudioNode[] = [];
  if (out) {
    mixed = out.ac.createMediaStreamDestination();
    if (sound.sounds) out.master.connect(mixed);
    if (sound.voice)
      for (const s of voiceStreams())
        if (s.getAudioTracks().length) {
          const src = out.ac.createMediaStreamSource(s);
          src.connect(mixed);
          sources.push(src);
        }
    tracks.push(...mixed.stream.getAudioTracks());
  }
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: type,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);
  const began = performance.now();

  // A tall clip stacks the caption (UX 356): its two columns would wrap word by word.
  const narrowShape = width / height < 1.2;
  if (narrowShape) document.body.classList.add("clip-narrow");
  shot.capturing++;
  const finish = () => {
    shot.capturing = Math.max(0, shot.capturing - 1);
    document.body.classList.remove("clip-narrow");
    stopFrames();
    for (const t of tracks) t.stop();
    for (const s of sources) s.disconnect();
    if (out && mixed && sound.sounds) out.master.disconnect(mixed);
  };
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        // The table stops; the end frame holds over its last picture, then the clip ends.
        stopFrames();
        const end = ending();
        const last = document.createElement("canvas");
        last.width = width;
        last.height = height;
        last.getContext("2d")!.drawImage(canvas, 0, 0);
        const shown = performance.now();
        const track = video.getVideoTracks()[0] as
          (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
        const timer = setInterval(() => {
          drawEnding(ctx, last, end, Math.min(1, (performance.now() - shown) / 300));
          // Each end frame is sent on, not left for the stream to notice.
          track?.requestFrame?.();
          if (performance.now() - shown < END_MS) return;
          clearInterval(timer);
          // A beat for the encoder to catch up, so the end frame isn't dropped at the stop.
          recorder.requestData();
          setTimeout(() => recorder.stop(), 400);
        }, 1000 / FPS);
        recorder.onstop = () => {
          finish();
          void withDuration(new Blob(chunks, { type: "video/webm" }), performance.now() - began).then(
            resolve,
          );
        };
      }),
    cancel: () => {
      recorder.onstop = finish;
      recorder.stop();
    },
  };
}

/**
 * A tall clip's top band (UX 367): each side's name, colour and VP, and the
 * round, so a phone-sized story says the score without the top bar.
 */
function drawScore(ctx: CanvasRenderingContext2D, width: number, band: number) {
  const game = useStore.getState().game;
  const rows = sides(game).map((seat) => ({
    name: displayName(sideName(game, seat)),
    color: sidePlayers(game, seat)[0]?.color ?? "#999",
    vp: game.resources[sidePlayers(game, seat)[0]?.id ?? ""]?.VP ?? 0,
  }));
  if (rows.length < 2 || band < 160) return;
  const unit = width / 1080;
  const h = Math.min(band * 0.3, 150 * unit);
  const y = h * 0.62;
  const font = (size: number, weight: number) =>
    (ctx.font = `${weight} ${size * unit}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  ctx.textBaseline = "alphabetic";
  rows.slice(0, 2).forEach((row, i) => {
    const left = i === 0;
    const x = left ? 48 * unit : width - 48 * unit;
    ctx.fillStyle = row.color;
    ctx.fillRect(left ? x : x - 10 * unit, y - 44 * unit, 10 * unit, 60 * unit);
    ctx.textAlign = left ? "left" : "right";
    font(28, 700);
    ctx.fillStyle = "#f4f1ea";
    ctx.fillText(row.name, left ? x + 24 * unit : x - 24 * unit, y - 20 * unit, width * 0.3);
    font(40, 800);
    ctx.fillText(`${row.vp} VP`, left ? x + 24 * unit : x - 24 * unit, y + 20 * unit);
  });
  if (game.turn.round > 0) {
    ctx.textAlign = "center";
    font(26, 600);
    ctx.fillStyle = "#b9b4a8";
    ctx.fillText(t("Round {n}", { n: game.turn.round }), width / 2, y);
  }
  ctx.textAlign = "left";
}

/** The clip's last frame: its last picture dimmed, the result, and where to play. */
function drawEnding(ctx: CanvasRenderingContext2D, last: HTMLCanvasElement, end: ClipEnding, fade: number) {
  const { width, height } = ctx.canvas;
  ctx.drawImage(last, 0, 0);
  ctx.fillStyle = `rgba(10, 11, 15, ${0.8 * fade})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = fade;
  ctx.textAlign = "center";
  const unit = Math.min(width, height) / 1080;
  const font = (size: number, weight: number) =>
    (ctx.font = `${weight} ${size * unit}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  font(86, 800);
  ctx.fillStyle = "#f4f1ea";
  ctx.fillText(end.title, width / 2, height / 2 - 20 * unit, width * 0.9);
  if (end.line) {
    font(40, 500);
    ctx.fillStyle = "#b9b4a8";
    ctx.fillText(end.line, width / 2, height / 2 + 50 * unit, width * 0.9);
  }
  font(44, 700);
  ctx.fillStyle = "#f5b942";
  ctx.fillText(end.url, width / 2, height / 2 + 150 * unit, width * 0.9);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}
