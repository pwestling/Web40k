import { fromBase64, toBase64 } from "../assets/base64";

/** Text gzipped and base64'd, to sit inside an HTML page (base64 has no "<"). */
export async function pack(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function unpack(data: string): Promise<string> {
  const stream = new Blob([fromBase64(data) as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
