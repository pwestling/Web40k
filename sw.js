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
const VERSION = "7745d7736272";
const FILES = ["assets/Board-DnxUczrx.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BZCIrYzt.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-BbJOKT6s.js","assets/EventSeat-rc08Qa70.js","assets/EventsUI-ClQypQB4.js","assets/FigureLibrary-BhltnTHC.js","assets/GameScreen-BFIy_Ai_.js","assets/MailLobby-BRzRDBVZ.js","assets/Miniatures-BGy01hTw.js","assets/OpenTables-CfOaTawg.js","assets/PhotoMatch-C5n4eC-D.js","assets/PlayerCard-DVUfBwXg.js","assets/RankedGame-BT_qSOIL.js","assets/RulesPage-CHIi8UrL.js","assets/StandeeMaker-BCWU63OD.js","assets/TableWarnings-CG63AzvH.js","assets/Workshop-Cg3TOBOM.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-D5fknYPK.js","assets/base64-gMTPUZJI.js","assets/book-Bz2NV6gs.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BgM4l0bJ.js","assets/de-De4LkrWQ.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-BM4wCDbf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-dnu-g1VC.js","assets/help-ZriI-z7W.js","assets/hooks-Cl7_NgQb.js","assets/http-Oe0ZTjb6.js","assets/idb-OWIpJU7O.js","assets/index-D2Rykerp.js","assets/index-EUhTXr_o.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-dZrtLUT4.js","assets/lesson-D27i7u3y.js","assets/levels-DlkUqTaf.js","assets/local-BzxAJbZQ.js","assets/mailbox-C76qWsYR.js","assets/meshShape-Cihoy0SR.js","assets/nostr-iRTwWD1r.js","assets/packageChange-Be729-6H.js","assets/page-DmiPmBek.js","assets/play-D8N3OtHg.js","assets/post-B9iWCKqQ.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-0wSS2Yiw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-f8Pc1RX4.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-DYF3664T.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-QpOHLm_f.js","assets/site-B823XLVz.js","assets/sound-Cx9urw_x.js","assets/standIns-BHeYT5qd.js","assets/store-DDiJjfr2.js","assets/store-DH0KDe_F.js","assets/store-DzZBZakr.js","assets/store-F1XyycSE.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-WOXJXOWa.js","assets/talk-CgTcoh6i.js","assets/three.module-BnHMTVNq.js","assets/thumb-BbGiVpEC.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
