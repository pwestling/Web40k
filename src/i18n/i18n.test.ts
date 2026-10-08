import { afterEach, describe, expect, it } from "vitest";
import { applyCatalog, loadLanguage, t, tc, tn } from ".";
import { parsePo, writePo } from "./po";

const DE = `
msgid ""
msgstr ""
"Language: de\\n"

#, fuzzy
msgid "Start battle"
msgstr "Schlacht beginnen"

msgid "Send to {name}"
msgstr "An {name} senden"

msgctxt "verb"
msgid "Charge"
msgstr "Angreifen"

msgid "{n} model"
msgid_plural "{n} models"
msgstr[0] "{n} Modell"
msgstr[1] "{n} Modelle"

msgid "Not yet"
msgstr ""
`;

describe("translations", () => {
  afterEach(() => loadLanguage("en"));

  it("reads a catalog: drafts, contexts, plurals; English where there's no translation", async () => {
    await loadLanguage("en");
    expect(t("Start battle")).toBe("Start battle");
    expect(tn(2, "{n} model", "{n} models")).toBe("2 models");
    await loadLanguage("de");
    applyCatalog(DE);
    expect(t("Start battle")).toBe("Schlacht beginnen");
    expect(t("Send to {name}", { name: "Bo" })).toBe("An Bo senden");
    expect(tc("verb", "Charge")).toBe("Angreifen");
    expect(t("Charge")).toBe("Charge");
    expect(tn(1, "{n} model", "{n} models")).toBe("1 Modell");
    expect(tn(1200, "{n} model", "{n} models")).toBe("1.200 Modelle");
    expect(t("Not yet")).toBe("Not yet");
  });

  it("writes back what it reads", () => {
    const entries = parsePo(DE);
    expect(parsePo(writePo(entries))).toEqual(entries);
    expect(entries.find((e) => e.id === "Start battle")?.fuzzy).toBe(true);
  });
});
