import type { SpecialDie, TemplateKind } from "..";

/**
 * Templates and special dice for the hand-played rank-and-flank system:
 * generic shapes and faces, sized in inches. Players can still measure and
 * roll anything by hand.
 */
export const TOW_TEMPLATES: TemplateKind[] = [
  { id: "small", label: "Small blast", shape: "circle", size: 3 },
  { id: "large", label: "Large blast", shape: "circle", size: 5 },
  { id: "flame", label: "Flame", shape: "flame", size: 8, width: 3 },
  { id: "line", label: "Line", shape: "line", size: 12 },
];

export const TOW_DICE: SpecialDie[] = [
  // Two faces of six mark a hit; the rest are arrows (the direction is rolled with them).
  { id: "scatter", name: "Scatter", faces: ["hit", "hit", "arrow", "arrow", "arrow", "arrow"] },
  { id: "artillery", name: "Artillery", faces: ["2", "4", "6", "8", "10", "misfire"] },
];
