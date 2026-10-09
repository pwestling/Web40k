// Open Battle's service worker (#34), built by the `serviceWorker` plugin in
// vite.config.ts, which fills in the build's files and version.
//
// - It keeps the app on the device, so hotseat, solo games, lessons, replays,
//   the shelves and the campaign book work without a network, and the app can
//   be installed. A new version waits until the player chooses to reload
//   (src/sw/register.ts says when: never mid-game).
// - It shows play-by-mail notifications (src/mail/mailbox.ts). A push from
//   the mailbox carries nothing about the game: it only says a file has come,
//   and the app fetches it from the mailbox when it opens.
const VERSION = "c43f73b9bd45";
const FILES = ["assets/Board-mHsYPE84.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-CHrZbe1F.js","assets/CommandPanel-CZLZtnuO.js","assets/CommandPanel-Cs4t9WQQ.js","assets/Editor-2J7SMoIw.js","assets/FigureLibrary-BW8FVvlw.js","assets/GameScreen-BQCfPj4M.js","assets/MailLobby-BzorXoFn.js","assets/Miniatures-BcQ7zEMB.js","assets/OpenTables-B2uSheoH.js","assets/Packages-XjkMLmnC.js","assets/PlayerCard-gkhburD3.js","assets/RankedGame-DE1pHc2n.js","assets/RulesPage-9F2thcki.js","assets/TableWarnings-2RaWLCkw.js","assets/Workshop-q0evfHPb.js","assets/_virtual_sandbox-worker-CJ-ov1m5.js","assets/_virtual_soak-worker-DfrTWup7.js","assets/book-B3UsHz8q.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DHTa8q4D.js","assets/de-CObhbHPP.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DrPK4k4-.js","assets/files-CdfAAl3C.js","assets/fr-Ci_IePmK.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DN822dck.js","assets/help-BQGu8eOr.js","assets/hooks-Re0YQ9ua.js","assets/http-BzWA_R0u.js","assets/index-BWfk-cov.js","assets/index-D3wZsW4I.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-D17aAF1Y.js","assets/lesson-d8NzcM34.js","assets/levels-DlkUqTaf.js","assets/local-FctL_ZY1.js","assets/mailbox-P5_nLDVX.js","assets/nostr-DX3dnvuA.js","assets/page-BSImHh80.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BL72MJyf.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-D9l32xNT.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-cLzkCxs1.js","assets/shelf-CZK-v8zs.js","assets/showcase-DagK-Rdj.js","assets/site-B823XLVz.js","assets/sound-BYcEVox8.js","assets/standIns-OXIxWlRR.js","assets/store-BkzJn7jh.js","assets/store-C11U8WTq.js","assets/store-CHJ5N2Ws.js","assets/store-CRcPU0xE.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Brd0vo34.js","assets/talk-BHCeSblM.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-DrfAidOf.js","assets/worker-X3JoFKas.js","assets/worker-nePbr9Hs.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
const CACHE = `open-battle-${VERSION}`;
const DEV = VERSION === "dev";
const at = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  if (DEV) return;
  event.waitUntil(
    caches
      .open(CACHE)
      // Hashed build files never change, so the copies the page just loaded will do; the rest
      // (index.html, the manifest, icons) are fetched fresh.
      .then((cache) =>
        cache.addAll(
          FILES.map((f) => new Request(at(f), { cache: /-[\w-]{8}\.\w+$/.test(f) ? "default" : "reload" })),
        ),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith("open-battle-") && n !== CACHE).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks for the waiting version once the player says reload.
self.addEventListener("message", (event) => {
  if (event.data?.t === "skip-waiting") self.skipWaiting();
});

/** Things that only make sense live: the server's config, signalling, the mailbox, health. */
const LIVE = /\/(config\.json|health\.json|health|relay|mailbox)(\/|$|\?)/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (DEV || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || LIVE.test(url.pathname)) return;
  if (request.mode === "navigate") {
    // The page: the network when it answers (it may carry a newer version), else the copy kept here.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(at("index.html"), { cacheName: CACHE }).then((r) => r ?? Response.error()),
      ),
    );
    return;
  }
  // The build's files never change under a name: the kept copy first.
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((kept) => kept ?? fetch(request)),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Your move · Open Battle", {
      body: "Your opponent sent their turn.",
      tag: "open-battle-mail",
      renotify: true,
      icon: at("icons/icon-192.png"),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});
