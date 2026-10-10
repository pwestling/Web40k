/// <reference lib="webworker" />
import { openai } from "./openai";
import {
  MatchError,
  type MatchRequest,
  type MatchResponse,
  type ProviderId,
  type VisionProvider,
} from "./types";

/** Photo matching runs here: shrinking the photos and waiting on the provider stay off the page's thread. */

const PROVIDERS: Record<ProviderId, VisionProvider> = { openai };

/** Longest side of a photo as sent: enough to tell units apart, small enough to send quickly. */
const PHOTO_SIDE = 1536;

async function shrink(photo: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo);
  } catch {
    throw new MatchError("photo");
  }
  const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

self.onmessage = async (e: MessageEvent<MatchRequest>) => {
  const { provider, key, model, photos, units, figures } = e.data;
  let reply: MatchResponse;
  try {
    const shrunk = await Promise.all(photos.map(shrink));
    const assignments = await PROVIDERS[provider].match({ key, model, photos: shrunk, units, figures });
    reply = { ok: true, assignments };
  } catch (err) {
    reply =
      err instanceof MatchError
        ? { ok: false, code: err.code, detail: err.message }
        : { ok: false, code: "other", detail: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
