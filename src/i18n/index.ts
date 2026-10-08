import { entryKey, parsePo } from "./po";

/**
 * Translations (#35). The app's text is written in English in the code, as
 * `t("Start battle")`, `t("Send to {name}", { name })` and
 * `tn(count, "{n} model", "{n} models")`. Each language is a gettext catalog
 * (src/i18n/locales/<id>.po) keyed by that English, so a missing translation
 * falls back to English. Numbers and dates use the browser's Intl for the
 * language. Game text (unit names, rules) comes from players' packages and is
 * never translated here. See docs/translating.md.
 */
export interface Language {
  id: string;
  /** The language's name in itself. */
  name: string;
  /** Machine-drafted, waiting for a native speaker to review. */
  draft?: boolean;
}

export const LANGUAGES: Language[] = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch", draft: true },
  { id: "fr", name: "Français", draft: true },
];

const KEY = "open-battle:language";
/** The catalogs, each loaded only when chosen. */
const CATALOGS: Record<string, () => Promise<string>> = {
  de: () => import("./locales/de.po?raw").then((m) => m.default),
  fr: () => import("./locales/fr.po?raw").then((m) => m.default),
};

let current = "en";
let messages = new Map<string, string[]>();
let rules = new Intl.PluralRules("en");

/** The language chosen on this device, else the browser's first one we have, else English. */
export function preferredLanguage(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // No storage: the browser's language.
  }
  if (saved && LANGUAGES.some((l) => l.id === saved)) return saved;
  const asked = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of asked) {
    const id = tag?.toLowerCase().split("-")[0];
    if (id && LANGUAGES.some((l) => l.id === id)) return id;
  }
  return "en";
}

/** Load the chosen language's catalog; before the app first renders (main.tsx). */
export async function loadLanguage(id = preferredLanguage()): Promise<void> {
  current = LANGUAGES.some((l) => l.id === id) ? id : "en";
  rules = new Intl.PluralRules(current);
  messages = new Map();
  if (typeof document !== "undefined") document.documentElement.lang = current;
  const load = CATALOGS[current];
  if (!load) return;
  try {
    applyCatalog(await load());
  } catch {
    // A catalog that won't load leaves the English.
  }
}

/** Use a catalog's text (also for tests). Drafts are used: they're better than English for most players. */
export function applyCatalog(po: string): void {
  messages = new Map();
  for (const e of parsePo(po))
    if (e.id && e.str.some(Boolean)) messages.set(entryKey(e.id, e.context), e.str);
}

export const language = () => current;

/** Choose a language: kept on this device, and the page reloads in it. */
export function setLanguage(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not kept: this visit only.
  }
  location.reload();
}

type Params = Record<string, string | number | null | undefined>;

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? all : typeof v === "number" ? formatNumber(v) : v;
  });
}

/** A UI string in the chosen language. `{name}` placeholders are filled from `params`. */
export function t(text: string, params?: Params): string {
  return fill(messages.get(text)?.[0] || text, params);
}

/** The same, for an English string that means different things in different places. */
export function tc(context: string, text: string, params?: Params): string {
  return fill(messages.get(entryKey(text, context))?.[0] || text, params);
}

/** Plural categories in the order a catalog's msgstr[n] lists them. */
const ORDER = ["zero", "one", "two", "few", "many", "other"];

/**
 * A count: `tn(3, "{n} model", "{n} models")`. `{n}` is the count, formatted
 * for the language; other placeholders come from `params`.
 */
export function tn(n: number, one: string, other: string, params?: Params): string {
  const forms = messages.get(one);
  let text = n === 1 ? one : other;
  if (forms?.some(Boolean)) {
    const used = ORDER.filter((c) =>
      rules.resolvedOptions().pluralCategories.includes(c as Intl.LDMLPluralRule),
    );
    text = forms[used.indexOf(rules.select(n))] || forms.at(-1) || text;
  }
  return fill(text, { n, ...params });
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, options).format(n);
}

export function formatDate(d: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(current, options).format(d);
}

/** "Ana, Bo and Cy" in the language. */
export function formatList(items: string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(current, { type }).format(items);
}
