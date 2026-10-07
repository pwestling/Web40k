import type { Model, Vec2 } from "./types";

export const MM_PER_INCH = 25.4;

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function baseRadiusInches(model: Pick<Model, "baseMm">): number {
  return mmToInches(model.baseMm) / 2;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 40k measures between the closest points of two bases. */
export function baseToBaseDistance(a: Model, b: Model): number {
  const d = distance(a.position, b.position) - baseRadiusInches(a) - baseRadiusInches(b);
  return Math.max(0, d);
}
