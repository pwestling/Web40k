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
const VERSION = "f775bda0c447";
const FILES = ["assets/Board-6HClfYFg.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-3yQFsu-Z.js","assets/CommandPanel-CX7v7KUQ.js","assets/CommandPanel-zf9H8-AP.js","assets/Editor-Cv68VNEE.js","assets/EventSeat-CuNG5SdU.js","assets/EventsUI-BH2eeLDA.js","assets/FigureLibrary-CKaAu_pR.js","assets/GameScreen-Dnz86Loz.js","assets/MailLobby-vRUc6gSa.js","assets/Miniatures-dfhtGhqa.js","assets/OpenTables-BbZJrLgv.js","assets/PhotoMatch-Ci9YXvyC.js","assets/PlayerCard-DO8r6szB.js","assets/RankedGame-B7qJOvvX.js","assets/RulesPage-BlbVs_QP.js","assets/StandeeMaker-DhSG30vD.js","assets/TableWarnings-Bm5Z9CuH.js","assets/Workshop-C9w5HYxx.js","assets/_virtual_sandbox-worker-BC2NVjiQ.js","assets/_virtual_soak-worker-BOdKv41l.js","assets/actions-CKioX1hR.js","assets/base64-gMTPUZJI.js","assets/book-B6ujk-f9.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-AczWdb9g.js","assets/core-CyPlKxPs.js","assets/de-uSZhY83T.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DoSQ0z6a.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Bqo3yxrG.js","assets/help-CDLGrB83.js","assets/http-7O3ACDRd.js","assets/idb-OWIpJU7O.js","assets/index-C4rxERlD.css","assets/index-DFpcB7cr.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BidqHzl5.js","assets/lesson-DK319D4g.js","assets/levels-DlkUqTaf.js","assets/local-D5NUkelV.js","assets/mailbox-CQdX5sWb.js","assets/meshShape-CFQZD9Ru.js","assets/nostr-DtUEsRlD.js","assets/pack-CYGD4q-M.js","assets/packageChange-Be729-6H.js","assets/page-B56IS7Xg.js","assets/play-Bx2apmyP.js","assets/post-DjwZVQbl.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DXMBcHKN.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-UsiYxmJX.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-C-qeBWHQ.js","assets/showcase-D0YtbTY6.js","assets/site-B823XLVz.js","assets/sound-CF7n-tYV.js","assets/standIns-BHeYT5qd.js","assets/store-BfbwqHvb.js","assets/store-DHkWCz0i.js","assets/store-Daf1aS3F.js","assets/store-DuOy4bhK.js","assets/store-nCFSN7yK.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-4TxGonat.js","assets/talk-CPWJFR-U.js","assets/three.module-BnHMTVNq.js","assets/thumb-BpyZblFL.js","assets/trystero-Chre6IBw.js","assets/trystero-D8Wph1NH.js","assets/worker-C8mUfY4K.js","assets/worker-CtrB5Iye.js","assets/worker-DAYkGTls.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
