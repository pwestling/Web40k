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
const VERSION = "328445e997a8";
const FILES = ["assets/Board-SCsgp-cS.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-DYgPZ_7C.js","assets/CommandPanel-m3kHMWV5.js","assets/CommandPanel-pvA1R2Ss.js","assets/Editor-C8_NuOvq.js","assets/EventSeat-TmGQuyk7.js","assets/EventsUI-6P9eOC9S.js","assets/FigureLibrary-BnfZ8c2i.js","assets/GameScreen-Cv0T8ZPL.js","assets/MailLobby-By6MUD4B.js","assets/Miniatures-DRcpw5td.js","assets/OpenTables-DWnL8l0R.js","assets/PhotoMatch-BeZlF43a.js","assets/PlayerCard-BM6FtxAE.js","assets/RankedGame-ROlnK-8S.js","assets/RulesPage-BvJoUAIY.js","assets/StandeeMaker-DIKivveR.js","assets/TeachRule-CJGLip-P.js","assets/Workshop-DrUuFWHv.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-CKN3vZUE.js","assets/actions-CRpbsgKK.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DpmrTMLZ.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-BrlsGzNt.js","assets/de-r_jtXtpO.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-IdlU4wPl.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Cq1RlHRF.js","assets/help-B97_JJwg.js","assets/http-Co6TqxXc.js","assets/idb-OWIpJU7O.js","assets/index-BRmhf4qV.js","assets/index-qKMv44Qs.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BWSw1OJK.js","assets/lesson-CGq39Zrm.js","assets/levels-DlkUqTaf.js","assets/local-B4KDSYPb.js","assets/mailbox-BQL7zGWC.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DY5wI3Hw.js","assets/nostr-BGTCJA8a.js","assets/pack-DIHWFxH8.js","assets/packageChange-Be729-6H.js","assets/page-Dd-k739l.js","assets/play-DQJMOBRn.js","assets/post-CDI2qPCi.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DEXoBYMZ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CuaLvAf9.js","assets/report-BiqzTFIW.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CLnJ88Ui.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-B3zDHDnT.js","assets/store-CLRf6WQp.js","assets/store-CkITwy9J.js","assets/store-CkSbtpN7.js","assets/store-heTkeg3t.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DDpclYNB.js","assets/talk-DeQq5Kxo.js","assets/three.module-BnHMTVNq.js","assets/thumb-CTF0O0gZ.js","assets/trystero-BUBkX64v.js","assets/trystero-DoYfPAdu.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-K8sTxT2w.js","assets/worker-S2msJMcs.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
