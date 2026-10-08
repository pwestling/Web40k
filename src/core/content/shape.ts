/**
 * The shape of a game system written by hand (a whole-game package, #41/#42):
 * the keys every system needs, with the right kinds of value. Each problem
 * names its path, e.g. "system.turn.rounds: should be a number (got "four")".
 * Cross-references (unknown actions, procedures) are validateSystem's job.
 */
export function shapeProblems(system: unknown): string[] {
  const out: string[] = [];
  const got = (v: unknown) =>
    typeof v === "string" ? `"${v}"` : v === undefined ? "nothing" : JSON.stringify(v);
  const say = (path: string, want: string, v: unknown) =>
    out.push(`system.${path}: should be ${want} (got ${got(v)})`);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(system)) return [`system: should be an object (got ${got(system)})`];
  const s = system;
  for (const key of ["id", "name", "version"])
    if (typeof s[key] !== "string" || !s[key]) say(key, "text", s[key]);
  const units = s.units;
  if (units !== "inch" && units !== "cm" && !isObj(units)) say("units", '"inch" or "cm"', units);

  const dice = Array.isArray(s.dice) ? s.dice : [];
  if (!Array.isArray(s.dice)) say("dice", "a list of dice", s.dice);
  dice.forEach((d, i) => {
    if (!isObj(d) || typeof d.id !== "string") say(`dice[${i}].id`, "text", isObj(d) ? d.id : d);
    else if (typeof d.sides !== "number" || d.sides < 2)
      say(`dice[${i}].sides`, "a number of sides", d.sides);
  });
  const dieIds = dice.filter(isObj).map((d) => d.id);
  if (!dieIds.includes(s.defaultDie))
    say(
      "defaultDie",
      `one of the dice (${dieIds.map((d) => `"${String(d)}"`).join(", ") || "none listed"})`,
      s.defaultDie,
    );

  if (!Array.isArray(s.characteristics)) say("characteristics", "a list", s.characteristics);
  else
    s.characteristics.forEach((c, i) => {
      if (!isObj(c)) return say(`characteristics[${i}]`, "an object", c);
      if (typeof c.id !== "string") say(`characteristics[${i}].id`, "text", c.id);
      if (!["model", "weapon", "unit"].includes(c.of as string))
        say(`characteristics[${i}].of`, '"model", "weapon" or "unit"', c.of);
      if (!["number", "target", "distance", "dice", "text"].includes(c.type as string))
        say(`characteristics[${i}].type`, '"number", "target", "distance", "dice" or "text"', c.type);
    });

  for (const key of ["weaponKinds", "rules", "procedures", "actions"])
    if (!Array.isArray(s[key])) say(key, "a list", s[key]);
  if (!isObj(s.unitShape) || !["skirmish", "ranked"].includes(s.unitShape.kind as string))
    say("unitShape", '{ kind: "skirmish" } or { kind: "ranked" }', s.unitShape);

  const turn = s.turn;
  if (!isObj(turn)) say("turn", "an object", turn);
  else {
    // Rounds: a number, or an expression object (never a word).
    if (typeof turn.rounds !== "number" && !isObj(turn.rounds)) say("turn.rounds", "a number", turn.rounds);
    if (!Array.isArray(turn.round) || !turn.round.length) say("turn.round", "a list of segments", turn.round);
    else
      turn.round.forEach((seg, i) => {
        const kinds = ["phase", "playerTurns", "alternate", "plan", "step"];
        if (!isObj(seg) || !kinds.includes(seg.kind as string))
          say(`turn.round[${i}].kind`, kinds.map((k) => `"${k}"`).join(", "), isObj(seg) ? seg.kind : seg);
      });
  }
  return out;
}

/** The line (1-based) of a problem's path in a package's source: where its last key is first written. */
export function lineOf(source: string, problem: string): number | null {
  const path = /^system\.([\w.[\]]+)/.exec(problem)?.[1];
  const key = path
    ?.replace(/\[\d+\]/g, "")
    .split(".")
    .at(-1);
  if (!key) return null;
  const start = source.search(/\bconst\s+system\b|\bsystem\s*[:=]\s*{/);
  const at = source.slice(Math.max(0, start)).search(new RegExp(`\\b${key}\\s*:`));
  if (at < 0) return null;
  return source.slice(0, Math.max(0, start) + at).split("\n").length;
}
