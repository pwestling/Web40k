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
const VERSION = "a800698aa21d";
const FILES = ["assets/Board-VmaD8hL1.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CPQ6DCaE.js","assets/CommandPanel-QF5D4UTu.js","assets/CommandPanel-uuw-rZF6.js","assets/Editor-CorLXLgG.js","assets/EventSeat-BY7i0nO6.js","assets/EventsUI-6VX1umST.js","assets/FigureLibrary-C5XHXIGu.js","assets/GameScreen-LxJ9-QRp.js","assets/MailLobby-MvJeM8Jk.js","assets/Miniatures-BCIRE_zn.js","assets/OpenTables-BKH3EVfD.js","assets/PhotoMatch-BSS7RmYG.js","assets/PlayerCard-BGi2aQG1.js","assets/RankedGame-C8FPRO-T.js","assets/RulesPage-DtK2BOXJ.js","assets/StandeeMaker-hMqEHKLe.js","assets/TeachRule-CS5fiij7.js","assets/Workshop-BlfzECCs.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-C2rg9kgP.js","assets/actions-C25NLVDf.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-Ca5KA9Rh.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-D1voELXR.js","assets/de-DOexSHdE.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-CjyZlrZi.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-hro1ybfM.js","assets/help-CMymJ6Rf.js","assets/http-CEMkW334.js","assets/idb-OWIpJU7O.js","assets/index-4cwzcQW7.js","assets/index-qKMv44Qs.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-qHJ6Imng.js","assets/lesson-BzzOPQPc.js","assets/levels-DlkUqTaf.js","assets/local-Cheo9d1R.js","assets/mailbox-BMDkt8b0.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DyZmzm7H.js","assets/nostr-DHrXjzd8.js","assets/pack-HpObY5yX.js","assets/packageChange-Be729-6H.js","assets/page-DjZIHFvX.js","assets/play-COG1zJbJ.js","assets/post-BmfLHT1_.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BrmghFpU.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CamV5eHt.js","assets/report-5KQTCxJx.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CxRqntKk.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-B6Rk3HFd.js","assets/store-BzU67ZZQ.js","assets/store-CWeiwhEl.js","assets/store-DodWtNxU.js","assets/store-nUdRNLu5.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DRUM4Ed7.js","assets/talk-CR1Dr0Gf.js","assets/three.module-BnHMTVNq.js","assets/thumb-BhNBc7mm.js","assets/trystero-C1sCJqiT.js","assets/trystero-D1L7vSgR.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-83Vl6lCx.js","assets/worker-CXbi2Dnb.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
