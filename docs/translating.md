# Translating Open Battle

Open Battle's interface can be shown in more than one language. Each language is a
[gettext](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html) catalog in
`src/i18n/locales/<language>.po`. Any PO editor can open it: [Poedit](https://poedit.net) on your
computer, or a hosted tool such as Weblate or Crowdin. A text editor also works.

Only the app's own text is translated here. Game text, such as unit, weapon and rule names and mission
rules, comes from the rules packages and army lists players bring, and stays as they wrote it.

## Check a draft translation

German and French started as machine drafts. In the catalog, every drafted string is marked `fuzzy`:

```po
#: src/ui/Lobby.tsx:183
#, fuzzy
msgid "Start a mail game"
msgstr "Ein Briefspiel beginnen"
```

1. Open the `.po` file. In Poedit, drafts show as "Needs work".
2. Read each draft. Fix it if needed, then clear the fuzzy mark. In Poedit, toggle "Needs work" off; in a
   text editor, delete the `#, fuzzy` line.
3. Send a pull request with the file.

The app uses drafts as well as checked strings, since a draft is usually better than English. The
language picker says "(draft translation)" until a language is checked.

## Placeholders, plurals and context

- **Placeholders.** `{name}`, `{n}` and similar are filled in by the app. Keep each one in the
  translation; you can move it anywhere in the sentence.
  `msgid "Send to {name}"` → `msgstr "An {name} senden"`.
- **Plurals.** A string with `msgid_plural` has one `msgstr[i]` per plural form of your language. The
  forms are numbered in this order, counting only the ones your language uses: zero, one, two, few,
  many, other. That's the order in
  [Unicode's plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html).
  German and French use one and other, so `msgstr[0]` is singular and `msgstr[1]` is plural.
- **Context.** `msgctxt` tells apart one English word that's translated differently in two places, such as
  "Charge" the verb and "Charge" the phase.
- **References.** The `#:` lines say where in the code a string is shown, if you need to see it in place.

Numbers and dates are formatted by the browser for the chosen language, so they need no translation.

## Add a language

1. Copy `src/i18n/messages.pot` to `src/i18n/locales/<code>.po`, where `<code>` is the language's
   two-letter code, such as `es`. Then set the `Language:` line in its header.
2. Add the language to `LANGUAGES` in `src/i18n/index.ts`, with its name written in that language. Mark it
   `draft: true` until a native speaker has checked it. Also add a line for it to `CATALOGS` in the same
   file.
3. Translate, then run `pnpm i18n` to check the file reads back cleanly.

## For developers

Write interface text in English through the helpers in `src/i18n`:

```tsx
import { t, tn } from "../i18n";

<button>{t("Start battle")}</button>
<span>{t("Waiting for {name}", { name })}</span>
<span>{tn(count, "{n} model", "{n} models")}</span>
```

- Pass whole sentences, with `{placeholders}`, rather than fragments joined in code, because word order
  differs between languages.
- The text argument must be a literal string, since the extractor reads the code without running it.
- Call `t()` when rendering, never at module top level, because catalogs load after modules.
- Use `formatNumber`, `formatDate` and `formatList` for numbers, dates and lists.
- Mark text that deliberately stays as written, such as the product name, with an `// i18n-ignore`
  comment on its line (`{/* i18n-ignore */}` in JSX).

`pnpm i18n` updates `src/i18n/messages.pot` from the code and adds new strings, untranslated, to every
catalog. CI runs `pnpm i18n:check`. It fails when the catalogs are out of date with the code, or when
JSX text or a `title`, `placeholder`, `aria-label`, `alt` or `label` attribute isn't wrapped. After
changing interface text, run `pnpm i18n` and commit the catalogs. Strings with no translation show in
English until someone translates them.
