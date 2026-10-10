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
const VERSION = "61bebe63cfa5";
const FILES = ["assets/Board-CHxVxUz5.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CUWZSGXu.js","assets/CommandPanel-DD17MxsE.js","assets/CommandPanel-GH_UMgcU.js","assets/Editor-GzVsI2in.js","assets/EventSeat-CqPCReDn.js","assets/EventsUI-bOQ9xOYO.js","assets/FigureLibrary-CbxX-qpM.js","assets/GameScreen-Z7K3VlZ_.js","assets/MailLobby-BIM-NpU5.js","assets/Miniatures-BF0HE8XW.js","assets/OpenTables-Bhxb0Rqy.js","assets/PhotoMatch-960iBq8Z.js","assets/PlayerCard-EodDNfGi.js","assets/RankedGame-DdQXjCNt.js","assets/RulesPage-j4xgb3vv.js","assets/StandeeMaker-qMUVCBHx.js","assets/TableWarnings-BeMOqP1V.js","assets/Workshop-C93nvCiZ.js","assets/_virtual_sandbox-worker-Ci5_c32w.js","assets/_virtual_soak-worker-DW1yYNgI.js","assets/base64-gMTPUZJI.js","assets/book-CrGOfoWz.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BU24tsfI.js","assets/de-Dd9kO4Mq.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Cj0zo1WX.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CR8jIkz2.js","assets/help-CHjlR2kn.js","assets/http-B3APrd7X.js","assets/idb-OWIpJU7O.js","assets/index-CFndLGrL.css","assets/index-DnGO9ng8.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-OVbaWsMP.js","assets/lesson-D_DEqYKS.js","assets/levels-DlkUqTaf.js","assets/local-AKW5iMjd.js","assets/mailbox-3AUDEUsK.js","assets/meshShape-DwTK57AR.js","assets/nostr-CcUUac7A.js","assets/packageChange-Be729-6H.js","assets/page-CnsB57Iq.js","assets/play-CKUdMOfi.js","assets/post-BQGm8OVw.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BXYiFIhW.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CzLUWrBY.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-CPc9yKwM.js","assets/site-B823XLVz.js","assets/sound-D6__947L.js","assets/standIns-BHeYT5qd.js","assets/store-DEDHJso1.js","assets/store-DWgCNhpw.js","assets/store-PFDOzF9a.js","assets/store-oU7a0m4D.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DzCkbrRM.js","assets/talk-DnXzSiZN.js","assets/three.module-BnHMTVNq.js","assets/thumb-XgTzS00i.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B-Mu9b6c.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-XFV41YTw.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
