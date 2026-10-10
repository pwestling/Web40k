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
const VERSION = "67b7d8e12c49";
const FILES = ["assets/Board-Ch8K-RAc.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel--af9i9OO.js","assets/CommandPanel-BjXkmYBG.js","assets/CommandPanel-DBjYEOqi.js","assets/Editor-CUcIwTq5.js","assets/EventSeat-BMjENUPY.js","assets/EventsUI-CoDSUAWG.js","assets/FigureLibrary-B5iF2HNb.js","assets/GameScreen-1rFctd66.js","assets/MailLobby-DPVApiKp.js","assets/Miniatures-BtmGNL1D.js","assets/OpenTables-CZs1edXi.js","assets/PhotoMatch-DWTvcJKm.js","assets/PlayerCard-reOQmHs6.js","assets/RankedGame-BzhEBRyG.js","assets/RulesPage-2WrlYHgs.js","assets/StandeeMaker-D6XcoYHN.js","assets/TableWarnings-C_HC2b75.js","assets/Workshop-r4WJ-Yg9.js","assets/_virtual_sandbox-worker-Ci5_c32w.js","assets/_virtual_soak-worker-ColcdU3F.js","assets/base64-gMTPUZJI.js","assets/book-D9LRJdrj.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DUxIx6Zd.js","assets/de-DM4ER8Pm.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DbnPCqSC.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Ddj9k9xm.js","assets/help-uWd3AJk8.js","assets/http-BrQ9wd1k.js","assets/idb-OWIpJU7O.js","assets/index-DXjYzZDx.js","assets/index-Er4MSKKx.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Tx8OUwI2.js","assets/lesson-DZh2E0d_.js","assets/levels-DlkUqTaf.js","assets/local-CYUbvXzZ.js","assets/mailbox-CbB-XjMQ.js","assets/meshShape-mOvZMIjn.js","assets/nostr-BmfbwwIr.js","assets/packageChange-Be729-6H.js","assets/page-C1ARd9yx.js","assets/play--Ir5OrlB.js","assets/post-DQCY1bMg.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CIk1bhBg.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DzRvelYT.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-SlGzeJ_X.js","assets/site-B823XLVz.js","assets/sound-CCUx_Oc0.js","assets/standIns-BHeYT5qd.js","assets/store-BOaxof07.js","assets/store-Clk64V4T.js","assets/store-Dl-HhjNJ.js","assets/store-Dz94JXOY.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BIOXm3VC.js","assets/talk-AKgwR-tG.js","assets/three.module-BnHMTVNq.js","assets/thumb-B4-GZCER.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-C_iudC0y.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DeoiGoiH.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
