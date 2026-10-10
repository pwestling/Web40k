---
name: ip-check
description: Check a diff, package or file for publisher IP (Games Workshop or other unit names, stats, points, rules text, art, trademarks on screen) before it is committed or shared. Use before any commit that touches sample armies, rules text, tests, games/ or docs, and on any community package.
---

# Publisher IP check

Open Battle ships mechanics, never a publisher's content. Players import their own army data at runtime. Getting this wrong can take the project down, so check before committing.

## What to look for

1. **Names.** Faction, unit, character, weapon, wargear, stratagem, detachment, spell or place names from a published game (for example Space Marines, Necrons, Intercessor, Bolter, Oath of Moment). Invented names are fine.
2. **Numbers tied to named things.** A real unit's statline, weapon profile or points. Generic numbers on invented units are fine.
3. **Rules text.** Sentences copied or closely paraphrased from a rulebook, codex, datasheet or card. Describe the mechanic in our own words.
4. **Art and models.** Images, textures, meshes or logos from a publisher or from sites that host them.
5. **Trademarks on screen.** On-screen labels describe how a game plays ("Sci-fi battle", "Rank and flank"), not trademarked names. The README disclaimer is the one place those names appear.
6. **Player data as fixtures.** Real army lists, BattleScribe or New Recruit exports, or TTS saves committed as test fixtures. Write test rosters by hand with made-up names.

## How

- Read the whole diff (`git diff main...HEAD`) or file, not a sample.
- Grep for likely hits: `git diff main...HEAD | grep -niwE "space marines?|astartes|necrons?|orks?|eldar|aeldari|tyranids?|t'au|tau empire|chaos|imperium|stratagems?|warhammer|games workshop|codex|bolters?|lasguns?|old world|empire of man"` (`-w` matches whole words, so "work" and "fork" don't hit; expect some false positives anyway and judge each one). The engine's own words for 11th-edition mechanics, such as `stratagem` in `src/systems/wh40k`, are mechanics and fine.
- For each hit, say whether it is a mechanic (fine), an invented name (fine) or publisher content (remove it).

## Report

List each finding with `file:line`, what it is and the fix. If nothing is found, say what was checked.
