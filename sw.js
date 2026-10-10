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
const VERSION = "2c373e553801";
const FILES = ["assets/Board-gB7xvxy7.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BF9RXGAa.js","assets/CommandPanel-Bp7gvja8.js","assets/CommandPanel-D1ZxemUv.js","assets/Editor-bP54wjln.js","assets/EventSeat-BGiEcsu2.js","assets/EventsUI-b45ZFoGE.js","assets/FigureLibrary-Cts840je.js","assets/GameScreen-DyZYu8ly.js","assets/MailLobby-0OW5qsDb.js","assets/Miniatures-DWWUuZdt.js","assets/OpenTables-DeHYXz9K.js","assets/PhotoMatch-5pDVU0by.js","assets/PlayerCard-BqZZfFYW.js","assets/RankedGame-BlblzFsg.js","assets/RulesPage-DsVf0eS8.js","assets/StandeeMaker-q8EL5u0R.js","assets/TableWarnings-Bae9cuF6.js","assets/Workshop-CTr--eRi.js","assets/_virtual_sandbox-worker-Cvl9Ar9B.js","assets/_virtual_soak-worker-BC35mbtH.js","assets/base64-gMTPUZJI.js","assets/book-6J70ljq1.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-CZWYFebK.js","assets/de-Dcqsd2Lm.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Brxbs6El.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-u0wTMJa7.js","assets/help-DQbAhWcL.js","assets/http-B98swl01.js","assets/idb-OWIpJU7O.js","assets/index-C4dbwRur.js","assets/index-CFndLGrL.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DXlMWN9i.js","assets/lesson-CWPr0ig5.js","assets/levels-DlkUqTaf.js","assets/local-Cn9PwqSc.js","assets/mailbox-ChfLZGFR.js","assets/meshShape-C-WHaD9w.js","assets/nostr-Duzv-tiw.js","assets/packageChange-Be729-6H.js","assets/page-DlPZf5Po.js","assets/play-CC8dAFU6.js","assets/post-CkY98a8s.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CFoqzDQd.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DUSkEGqg.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-MHnmLMxB.js","assets/site-B823XLVz.js","assets/sound-Ro18ZlP1.js","assets/standIns-BHeYT5qd.js","assets/store-CUB-VKeU.js","assets/store-DA70JpX3.js","assets/store-DJc5kVSS.js","assets/store-L5xRlbQ3.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Co7RqwfK.js","assets/talk-ConI9jzd.js","assets/three.module-BnHMTVNq.js","assets/thumb-C6_S4pvQ.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-C3fwS8qC.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-aOeMFAZd.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
