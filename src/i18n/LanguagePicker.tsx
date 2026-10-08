import { language, LANGUAGES, setLanguage, t } from ".";

/** The app's language, for this device (#35). On the start page: choosing one reloads the page in it. */
export function LanguagePicker() {
  const now = language();
  return (
    <div className="language-picker">
      <label className="row">
        <span>{t("Language")}</span>
        <select value={now} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.draft ? t("{language} (draft translation)", { language: l.name }) : l.name}
            </option>
          ))}
        </select>
      </label>
      {LANGUAGES.find((l) => l.id === now)?.draft && (
        <a
          className="small"
          href="https://github.com/pwestling/Web40k/blob/main/docs/translating.md"
          target="_blank"
          rel="noreferrer"
        >
          {t("Help check this translation")}
        </a>
      )}
    </div>
  );
}
