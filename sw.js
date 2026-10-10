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
const VERSION = "1dabafea20fd";
const FILES = ["assets/Board-D9GXtkal.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-Cb_GiKh2.js","assets/CommandPanel-DEON6f7A.js","assets/CommandPanel-DZyT95dX.js","assets/Editor-BYxEC8-C.js","assets/EventSeat-3VGtR4f3.js","assets/EventsUI-BuBi7Rf7.js","assets/FigureLibrary-KSmlQ4MT.js","assets/GameScreen-NjP97hkl.js","assets/MailLobby-0aF7XaLB.js","assets/Miniatures-DFSl4vxk.js","assets/OpenTables-DWEK55w3.js","assets/PhotoMatch-BHf1qNsI.js","assets/PlayerCard-D1iTVLWt.js","assets/RankedGame-6B3GSUJt.js","assets/RulesPage-Btv2ZJ-P.js","assets/StandeeMaker-BX248P9j.js","assets/TableWarnings-BxPLHYxz.js","assets/Workshop-B1Jc8iO2.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-xlD6BiGJ.js","assets/actions-DIiwjNtm.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DGPtvolx.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-Kg6xkhHB.js","assets/core-Cnbjktwk.js","assets/de-CxK2lnJp.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BcoqRNfG.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DrqBbDJT.js","assets/help-C3WAStx6.js","assets/http-C72d6Ig_.js","assets/idb-OWIpJU7O.js","assets/index-C4rxERlD.css","assets/index-DmAGgYUy.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-PQJsqscY.js","assets/lesson-CnG6_i-D.js","assets/levels-DlkUqTaf.js","assets/local-BKaLQUAa.js","assets/mailbox-G88LDv3O.js","assets/manifest-bE-32xpp.js","assets/meshShape-B0f6BCND.js","assets/nostr-B3DciozW.js","assets/pack-75M-8dY4.js","assets/packageChange-Be729-6H.js","assets/page-BoMX6I3R.js","assets/play-CTCyXjNA.js","assets/post-D9jqnyuU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DJxhrxCu.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CoB7hTbZ.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BRqhWJdS.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-C569MR_C.js","assets/store-CdWJYJp9.js","assets/store-DOIMJj2X.js","assets/store-DphzXzz-.js","assets/store-rio7cMyI.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-ByekxGlh.js","assets/talk-C-lXKuzM.js","assets/three.module-BnHMTVNq.js","assets/thumb-BYOSG-hn.js","assets/trystero-B6gLvrIU.js","assets/trystero-CnTvyFix.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-5JgzGgQo.js","assets/worker-CtrB5Iye.js","assets/worker-D13R8NmG.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
