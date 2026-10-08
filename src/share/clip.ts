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

export interface ClipSound {
  /** Dice, bells and the room. */
  sounds: boolean;
  /** Table talk: this device's mic and each player's voice. */
  voice: boolean;
}

/** Clips are at most this wide (a 4K screen would make a file too big to post). */
const MAX_WIDTH = 1920;
const FPS = 30;

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

export function startClip(sound: ClipSound): Recording | null {
  const table = tableCanvas();
  const type = mimeType();
  if (!table || !type) return null;
  const rect = table.getBoundingClientRect();
  const width = Math.min(MAX_WIDTH, table.width) & ~1;
  const height = Math.round((width * rect.height) / Math.max(1, rect.width)) & ~1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const stopFrames = everyFrame((src) => {
    // The page may have scrolled or resized since: measure each frame.
    const r = src.getBoundingClientRect();
    ctx.drawImage(src, 0, 0, width, height);
    paintOverlays(ctx, { left: r.left, top: r.top, scale: width / Math.max(1, r.width) });
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

  const finish = () => {
    stopFrames();
    for (const t of tracks) t.stop();
    for (const s of sources) s.disconnect();
    if (out && mixed && sound.sounds) out.master.disconnect(mixed);
  };
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          finish();
          void withDuration(new Blob(chunks, { type: "video/webm" }), performance.now() - began).then(
            resolve,
          );
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = finish;
      recorder.stop();
    },
  };
}
