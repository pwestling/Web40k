import sciFi from "../../examples/lessons/sci-fi.js?raw";
import fsd from "../../examples/lessons/fsd.js?raw";
import rankAndFlank from "../../examples/lessons/rank-and-flank.js?raw";
import conquest from "../../examples/lessons/conquest.js?raw";
import { listSystems } from "../core/content";
import { systemMatches } from "../packages/library";
import { readLessonPackage, type Lesson, type LessonPackage } from "./lesson";

/** The lessons that come with the app: one lesson package per built-in game, read like any other. */
export const BUILT_IN_LESSONS: string[] = [sciFi, rankAndFlank, conquest, fsd];

export function lessonPackages(sources: string[] = BUILT_IN_LESSONS): LessonPackage[] {
  return sources.flatMap((s) => {
    const r = readLessonPackage(s);
    return "error" in r ? [] : [r];
  });
}

/** The installed system a lesson teaches ("forty-k" names "forty-k-11"), if there is one. */
export function lessonSystem(lesson: Lesson): string | undefined {
  return listSystems().find((s) => systemMatches(lesson.system, s.id))?.id;
}
