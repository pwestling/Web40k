import { create } from "zustand";

/**
 * The player's own storage bucket (Cloudflare R2, Amazon S3, Backblaze B2,
 * MinIO: anything that speaks S3). Shared files are uploaded there as well
 * as to the seed nodes, and the bucket's public address becomes one of the
 * torrent's web seeds, so the player's own storage keeps their links alive.
 *
 * The keys stay on this device (localStorage) and the browser signs each
 * upload itself (AWS Signature V4); they never go to Open Battle or any seed
 * node. Files go under `open-battle/<sha256>`, opaque when shared privately.
 * Use keys that can only write to that one bucket.
 */
export interface Bucket {
  /** The S3 API endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** "auto" for R2; the bucket's region for S3. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Where the bucket's files can be read publicly, e.g. https://pub-….r2.dev or your own domain. */
  publicUrl: string;
}

const KEY = "open-battle:bucket";
const PREFIX = "open-battle";

function stored(): Bucket | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Bucket) : null;
  } catch {
    return null;
  }
}

export const useBucket = create<{ bucket: Bucket | null }>(() => ({ bucket: stored() }));

export function setBucket(bucket: Bucket | null): void {
  useBucket.setState({ bucket });
  try {
    if (bucket) globalThis.localStorage?.setItem(KEY, JSON.stringify(bucket));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Private mode: kept until the page closes.
  }
}

const trim = (s: string) => s.trim().replace(/\/+$/, "");

/** Whether every field is filled in with something usable. */
export function bucketReady(b: Bucket | null): b is Bucket {
  return (
    !!b &&
    /^https:\/\/\S+$/.test(trim(b.endpoint)) &&
    /^https:\/\/\S+$/.test(trim(b.publicUrl)) &&
    !!b.bucket.trim() &&
    !!b.accessKeyId.trim() &&
    !!b.secretAccessKey.trim()
  );
}

/** Where a file goes in the bucket (path style), and where it can be read. */
export function bucketUrls(b: Bucket, sha: string): { put: string; get: string } {
  const object = `${PREFIX}/${sha}`;
  return {
    put: `${trim(b.endpoint)}/${encodeURIComponent(b.bucket.trim())}/${object}`,
    get: `${trim(b.publicUrl)}/${object}`,
  };
}

/** Upload a file, signed on this device; its public address, or an error to show. */
export async function upload(
  b: Bucket,
  payload: Uint8Array,
  sha: string,
  send: typeof fetch = (...a) => fetch(...a),
): Promise<{ url: string } | { error: string }> {
  const { AwsClient } = await import("aws4fetch");
  const aws = new AwsClient({
    accessKeyId: b.accessKeyId.trim(),
    secretAccessKey: b.secretAccessKey.trim(),
    service: "s3",
    region: b.region.trim() || "auto",
  });
  const { put, get } = bucketUrls(b, sha);
  try {
    const signed = await aws.sign(put, {
      method: "PUT",
      body: payload as BodyInit,
      headers: { "content-type": "application/octet-stream" },
    });
    const res = await send(signed);
    if (!res.ok) return { error: `${res.status}` };
    return { url: get };
  } catch {
    return { error: "network" };
  }
}
