import files from "virtual:sdk-types";
import { createChecker } from "./checker";
import type { TypeRequest } from "./client";

/**
 * The workshop's type checker (#43) in a worker of its own, so TypeScript
 * (a large download, fetched only when the workshop opens) checks drafts off
 * the page's thread. It only reads the draft's text: nothing of it runs here.
 */
const checker = createChecker(files);

self.onmessage = (e: MessageEvent<TypeRequest & { id: number }>) => {
  const m = e.data;
  let result: unknown = null;
  try {
    if (m.t === "problems") result = checker.problems(m.source);
    else if (m.t === "hover") result = checker.hover(m.source, m.pos);
    else if (m.t === "complete") result = checker.complete(m.source, m.pos);
    else if (m.t === "detail") result = checker.detail(m.source, m.pos, m.name);
  } catch (err) {
    console.warn("type check failed", err);
  }
  self.postMessage({ id: m.id, result });
};
