/**
 * Matching figures to units from a photo with a vision model the player has a
 * key for. Providers are pluggable: each turns a MatchRequest into a list of
 * assignments. Everything here runs in the vision worker, never on the main
 * thread, and talks straight from the player's browser to the provider.
 */

export type ProviderId = "openai";

/** One unit of the army being imported, by its row in the roster. */
export interface MatchUnit {
  index: number;
  name: string;
  models: number;
}

/** One library figure, with its thumbnail (a data URL) when it has one. */
export interface MatchFigure {
  id: string;
  name: string;
  tags: string[];
  thumb?: string;
}

export interface MatchRequest {
  provider: ProviderId;
  key: string;
  model: string;
  /** The player's photos as they chose them; the worker shrinks them before sending. */
  photos: Blob[];
  units: MatchUnit[];
  figures: MatchFigure[];
}

/** A figure proposed for a unit. The player confirms it in the import table. */
export interface Assignment {
  unit: number;
  figure: string;
  /** 0 to 1, as the model rated it. */
  confidence: number;
  /** A few words on why, in the model's own words (English). */
  why: string;
}

/** What went wrong, for the page to say in the player's language. */
export type MatchErrorCode = "key" | "quota" | "model" | "photo" | "network" | "answer" | "other";

export type MatchResponse =
  { ok: true; assignments: Assignment[] } | { ok: false; code: MatchErrorCode; detail?: string };

/** Photos and figures as the provider receives them: shrunk, labelled. */
export interface PreparedRequest {
  key: string;
  model: string;
  photos: string[];
  units: MatchUnit[];
  figures: MatchFigure[];
}

export interface VisionProvider {
  id: ProviderId;
  /** Ask the model; throw a MatchError when it can't answer. */
  match(request: PreparedRequest, fetcher?: typeof fetch): Promise<Assignment[]>;
}

export class MatchError extends Error {
  constructor(
    readonly code: MatchErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}
