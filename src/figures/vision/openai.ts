import { MatchError, type Assignment, type PreparedRequest, type VisionProvider } from "./types";

const ENDPOINT = "https://api.openai.com/v1/responses";

const INSTRUCTIONS = [
  "You help a wargamer dress the units of an imported army list in 3D figures from their own library.",
  "You get photos of their painted miniatures, the army's units (labelled U1, U2, ...) and the library's figures (labelled F1, F2, ...), each figure with a small render of its 3D mesh.",
  "For each unit you can recognise in the photos, pick the library figure that looks most like that unit's miniatures: compare silhouette, pose, armour, weapons, wings, size and base, not paint colour (the renders may be grey).",
  'If no library figure fits a unit, or the unit isn\'t in the photos and nothing in the library is clearly meant for it, give that unit figure "".',
  "One figure may suit several units. Confidence runs from 0 (a guess) to 1 (certain). Keep why under 15 words.",
].join(" ");

/** The JSON shape the answer must take (structured outputs, strict). */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignments"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unit", "figure", "confidence", "why"],
        properties: {
          unit: { type: "string", description: "The unit's label, like U3." },
          figure: { type: "string", description: 'The figure\'s label, like F7, or "" for none.' },
          confidence: { type: "number" },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

type Content =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

/** The Responses API request body for a match. */
export function openaiBody(request: PreparedRequest) {
  const content: Content[] = [
    {
      type: "input_text",
      text:
        "Army units:\n" +
        request.units
          .map((u, i) => `U${i + 1}: ${u.name} (${u.models} model${u.models === 1 ? "" : "s"})`)
          .join("\n"),
    },
    { type: "input_text", text: `Photos of the player's miniatures (${request.photos.length}):` },
    ...request.photos.map((url): Content => ({ type: "input_image", image_url: url, detail: "high" })),
    { type: "input_text", text: "Library figures:" },
  ];
  request.figures.forEach((f, i) => {
    const tags = f.tags.length ? ` [${f.tags.join(", ")}]` : "";
    content.push({
      type: "input_text",
      text: `F${i + 1}: ${f.name}${tags}${f.thumb ? "" : " (no picture)"}`,
    });
    if (f.thumb) content.push({ type: "input_image", image_url: f.thumb, detail: "low" });
  });
  return {
    model: request.model,
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "figure_assignments", strict: true, schema: SCHEMA } },
    store: false,
  };
}

interface ResponsesBody {
  status?: string;
  output_text?: string;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
}

/** The model's text out of a Responses API body. */
function outputText(body: ResponsesBody): string {
  if (typeof body.output_text === "string") return body.output_text;
  let text = "";
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new MatchError("answer", part.refusal);
      if (part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

/**
 * Turn the model's answer back into assignments by unit row and figure id,
 * dropping labels it made up and keeping the surest pick for each unit.
 */
export function readOpenaiAnswer(body: ResponsesBody, request: PreparedRequest): Assignment[] {
  const text = outputText(body);
  if (!text)
    throw new MatchError("answer", body.status === "incomplete" ? "The answer was cut short." : undefined);
  let parsed: { assignments?: { unit?: unknown; figure?: unknown; confidence?: unknown; why?: unknown }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MatchError("answer", "The answer wasn't JSON.");
  }
  const best = new Map<number, Assignment>();
  for (const a of parsed.assignments ?? []) {
    const u = label(a.unit, "U");
    const f = label(a.figure, "F");
    const unit = u === null ? undefined : request.units[u];
    const figure = f === null ? undefined : request.figures[f];
    if (!unit || !figure) continue;
    const confidence = typeof a.confidence === "number" ? Math.min(1, Math.max(0, a.confidence)) : 0;
    const why = typeof a.why === "string" ? a.why.slice(0, 200) : "";
    const had = best.get(unit.index);
    if (!had || had.confidence < confidence)
      best.set(unit.index, { unit: unit.index, figure: figure.id, confidence, why });
  }
  return [...best.values()].sort((a, b) => a.unit - b.unit);
}

/** "U3" → 2; anything else → null. */
function label(value: unknown, prefix: string): number | null {
  if (typeof value !== "string") return null;
  const m = new RegExp(`^\\s*${prefix}(\\d+)\\s*$`, "i").exec(value);
  return m ? Number(m[1]) - 1 : null;
}

export const openai: VisionProvider = {
  id: "openai",
  async match(request, fetcher = fetch) {
    let res: Response;
    try {
      res = await fetcher(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${request.key}` },
        body: JSON.stringify(openaiBody(request)),
      });
    } catch (e) {
      throw new MatchError("network", e instanceof Error ? e.message : undefined);
    }
    const body = (await res.json().catch(() => ({}))) as ResponsesBody & {
      error?: { message?: string; code?: string };
    };
    if (!res.ok) {
      const detail = body.error?.message;
      if (res.status === 401 || res.status === 403) throw new MatchError("key", detail);
      if (res.status === 429) throw new MatchError("quota", detail);
      if (res.status === 404 || body.error?.code === "model_not_found") throw new MatchError("model", detail);
      if (res.status === 400 && /image/i.test(detail ?? "")) throw new MatchError("photo", detail);
      throw new MatchError("other", detail ?? `HTTP ${res.status}`);
    }
    return readOpenaiAnswer(body, request);
  },
};
