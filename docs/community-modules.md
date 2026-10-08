# Community modules

Game systems and rules packages other players have written, listed by link. Open Battle doesn't host them: each file lives wherever its author keeps it (a GitHub repo, a gist), and players load it by that link.

**To try one**, open **Module workshop** on the start page, choose **Open from a link** and paste the module's raw link. It opens as a draft you can read before anything runs; **Test table** then plays it in the sandbox. To play it with friends, **Download the package** and load it under **Rules packages** in the lobby, or load it straight from the file.

**The fingerprint** is the start of the file's SHA-256. The workshop's Export tab shows it, and so does the package's consent sheet. If the bytes at a link change, the fingerprint changes too, and every player is asked again.

## Modules

| Module                                                                                                        | Version | Author                   | Systems       | What it adds                                                                                                                                             | Fingerprint |
| ------------------------------------------------------------------------------------------------------------- | ------- | ------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| [Rift Lanterns](https://raw.githubusercontent.com/pwestling/Web40k/main/games/rift-lanterns/rift-lanterns.js) | 1.0.0   | Open Battle contributors | rift-lanterns | Our own skirmish game: four warbands, three missions, a starter table. CC BY 4.0; [rules](../games/rift-lanterns/README.md). It also ships with the app. | `d59f 1eb4` |

To open a module in the workshop, paste its link into **Open from a link**, or add `?workshop=<its raw link>` to Open Battle's address.

## Starter templates

The workshop starts new drafts from these. They're in this repository, so they're a good place to read how a whole game fits in one file.

| Template                                                       | What it shows                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Skirmish](../examples/workshop/skirmish.js)                   | Model-by-model movement, a code action within 1", wounds               |
| [Ranked](../examples/workshop/ranked.js)                       | Regiment blocks, arcs, a clash using the front rank and rank bonus     |
| [Alternating activations](../examples/workshop/activations.js) | A round of alternating unit activations, range and shooting            |
| [Rift Lanterns](../games/rift-lanterns/rift-lanterns.js)       | A finished game: factions, missions, stand-in figures, a starter table |

[Arena](../examples/packages/arena.js), a small game with hooks and a side panel, isn't a template, but it opens in the workshop from its link like any module.

## Adding yours

1. Write and test it in the **Module workshop**: play it on the **Test table**, and run the **Soak bot**, which plays three whole bot games and checks nothing breaks.
2. Put the file somewhere with a stable raw link (a GitHub repo or a gist; `raw.githubusercontent.com` links work from the workshop).
3. In the workshop's **Export** tab, paste that link and click **Copy the pull request text**. It has your module's table row and its full SHA-256.
4. Click **Edit the gallery on GitHub**, add the row to the table above, and open a pull request with the copied text as its description.

Please don't list modules that contain Games Workshop's (or any other publisher's) rules text, names or stats. Rules mechanics written in your own words, with made-up sample armies, are fine; players bring their own army data. See [docs/packages.md](packages.md) for how packages work and what the sandbox allows.
