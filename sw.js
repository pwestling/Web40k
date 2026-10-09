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
const VERSION = "5960fc7ddd3a";
const FILES = ["assets/Board-CeTG05IP.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-Bspsrs1F.js","assets/CommandPanel-Dd8ATKow.js","assets/CommandPanel-petlOLsj.js","assets/Editor-LBiNlPZD.js","assets/EventSeat-CAEqQYwK.js","assets/EventsUI-rsvcqedF.js","assets/FigureLibrary-BsegwMS_.js","assets/GameScreen-BAXkl7zd.js","assets/MailLobby-DGMsgUBk.js","assets/Miniatures-DdBCWdTX.js","assets/OpenTables-2j_Y2WHo.js","assets/Packages-B1fvGtCp.js","assets/PlayerCard-CDhhkA5y.js","assets/RankedGame-BzFJkbe4.js","assets/RulesPage-CGQgSQZV.js","assets/TableWarnings-Dy6oXP1I.js","assets/Workshop-CtcoZJOW.js","assets/_virtual_sandbox-worker-Dct3xvTj.js","assets/_virtual_soak-worker-D_B1XrA8.js","assets/book-0YbbqmiU.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BVZeKnk6.js","assets/de--IVyn3Xj.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CbKeADtG.js","assets/files-CdfAAl3C.js","assets/fr-Cr6umPKI.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CXxdsfVx.js","assets/help-RozooxAq.js","assets/hooks-68cOz-oz.js","assets/http-Dy8DTCEH.js","assets/index-8-N0eDPk.css","assets/index-C9GZoPL0.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-CMVYqiED.js","assets/lesson-Bn_2f97p.js","assets/levels-DlkUqTaf.js","assets/local-D_DnzsvK.js","assets/mailbox-DOS-gPxV.js","assets/nostr-D9J-DaQc.js","assets/packageChange-Be729-6H.js","assets/page-CDbI_ySs.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-6BqkXMrs.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-1ZZrKced.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-KgISIxez.js","assets/shelf-DP09T6Od.js","assets/showcase-CWG_wkHX.js","assets/site-B823XLVz.js","assets/sound-TYxYIDVS.js","assets/standIns-OXIxWlRR.js","assets/store-CqY_vDMH.js","assets/store-D19PcBqc.js","assets/store-D7y-R4EI.js","assets/store-DHhBFQFs.js","assets/store-DICyPkNH.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-uNUwebbL.js","assets/talk-Bjm7Efep.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-BNLWGZ6f.js","assets/worker-CXxhG2_l.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
