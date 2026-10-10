import { describe, expect, it } from "vitest";
import type { FigureEntry } from "../library";
import { openai, openaiBody, readOpenaiAnswer } from "./openai";
import { figuresFor } from "./pick";
import type { PreparedRequest } from "./types";

const request: PreparedRequest = {
  key: "sk-test",
  model: "gpt-test",
  photos: ["data:image/jpeg;base64,AAAA"],
  units: [
    { index: 0, name: "Intercessor Squad", models: 5 },
    { index: 2, name: "Captain", models: 1 },
  ],
  figures: [
    { id: "aaa", name: "marine body", tags: [], thumb: "data:image/webp;base64,BBBB" },
    { id: "bbb", name: "captain", tags: ["hq"] },
  ],
};

const answer = (assignments: unknown) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ assignments }) }] }],
});

describe("photo matching with OpenAI", () => {
  it("labels units and figures, and sends the photo and the thumbnails", () => {
    const body = openaiBody(request);
    const content = body.input[0]!.content;
    expect(content[0]).toMatchObject({
      type: "input_text",
      text: expect.stringContaining("U2: Captain (1 model)"),
    });
    expect(content.filter((c) => c.type === "input_image")).toHaveLength(2);
    expect(JSON.stringify(content)).toContain("F2: captain [hq] (no picture)");
    expect(body.text.format.strict).toBe(true);
    expect(body.store).toBe(false);
  });

  it("maps labels back to rows and ids, drops made-up labels, keeps the surest pick", () => {
    const got = readOpenaiAnswer(
      answer([
        { unit: "U1", figure: "F1", confidence: 0.4, why: "power armour" },
        { unit: "u1", figure: "F2", confidence: 0.9, why: "better" },
        { unit: "U2", figure: "F9", confidence: 1, why: "no such figure" },
        { unit: "U7", figure: "F1", confidence: 1, why: "no such unit" },
        { unit: "U2", figure: "", confidence: 0, why: "none" },
      ]),
      request,
    );
    expect(got).toEqual([{ unit: 0, figure: "bbb", confidence: 0.9, why: "better" }]);
  });

  it("says why when the request fails", async () => {
    const fake = (status: number, error: object) => async () =>
      new Response(JSON.stringify({ error }), { status });
    await expect(openai.match(request, fake(401, { message: "bad key" }))).rejects.toMatchObject({
      code: "key",
    });
    await expect(openai.match(request, fake(429, {}))).rejects.toMatchObject({ code: "quota" });
    await expect(
      openai.match(request, async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toMatchObject({ code: "network" });
    const ok = async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
      return new Response(
        JSON.stringify(answer([{ unit: "U2", figure: "F2", confidence: 0.8, why: "cape" }])),
      );
    };
    expect(await openai.match(request, ok)).toEqual([
      { unit: 2, figure: "bbb", confidence: 0.8, why: "cape" },
    ]);
  });

  it("sends the figures that fit first when the library is big", () => {
    const e = (name: string, addedAt: number): FigureEntry => ({
      id: name,
      name,
      kind: "miniature",
      tags: [],
      units: [],
      bytes: 1,
      triangles: 1,
      height: 1,
      addedAt,
    });
    const library = [e("ruin wall", 9), e("gretchin", 5), e("captain in gravis", 1), e("ork boy", 3)];
    expect(figuresFor(library, ["Captain"], 2).map((f) => f.name)).toEqual([
      "captain in gravis",
      "ruin wall",
    ]);
  });
});
