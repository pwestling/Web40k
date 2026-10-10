import { describe, expect, it } from "vitest";
import { bucketReady, bucketUrls, upload, type Bucket } from "./bucket";

// The player's own bucket. Endpoints and keys below are made up.
const bucket: Bucket = {
  endpoint: "https://acct.r2.example/",
  bucket: "my-armies",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-example",
  publicUrl: "https://files.example/",
};
const SHA = "a".repeat(64);

describe("player's bucket", () => {
  it("is ready only with every field, over https", () => {
    expect(bucketReady(bucket)).toBe(true);
    expect(bucketReady({ ...bucket, secretAccessKey: " " })).toBe(false);
    expect(bucketReady({ ...bucket, publicUrl: "http://files.example" })).toBe(false);
    expect(bucketReady(null)).toBe(false);
  });

  it("puts a file under its hash and reads it from the public address", () => {
    expect(bucketUrls(bucket, SHA)).toEqual({
      put: `https://acct.r2.example/my-armies/open-battle/${SHA}`,
      get: `https://files.example/open-battle/${SHA}`,
    });
  });

  it("signs the upload on this device, sending the keys nowhere", async () => {
    const sent: Request[] = [];
    const send = (async (req: Request) => {
      sent.push(req);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await upload(bucket, new TextEncoder().encode("opaque"), SHA, send);
    expect(r).toEqual({ url: `https://files.example/open-battle/${SHA}` });
    const req = sent[0]!;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(`https://acct.r2.example/my-armies/open-battle/${SHA}`);
    expect(req.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify([...req.headers])).not.toContain("secret-example");
  });

  it("passes on what the bucket said when it refuses", async () => {
    const send = (async () => new Response(null, { status: 403 })) as typeof fetch;
    expect(await upload(bucket, new Uint8Array([1]), SHA, send)).toEqual({ error: "403" });
  });
});
