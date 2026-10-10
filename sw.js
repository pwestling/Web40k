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
const VERSION = "27f5f1f2fb1a";
const FILES = ["assets/Board-6NAdiY_C.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CjTE6Sv2.js","assets/CommandPanel-DSGeIVBX.js","assets/CommandPanel-Ir6Y-vJD.js","assets/Editor-DnwOOK53.js","assets/EventSeat-CgaJIG5Z.js","assets/EventsUI-B90Xr1Bh.js","assets/FigureLibrary-CU7cpx3V.js","assets/GameScreen-BK-z_Hch.js","assets/MailLobby-5FrUtUQi.js","assets/Miniatures-BCJPNC12.js","assets/OpenTables-CcgbLJ2y.js","assets/PhotoMatch-BZf8Y4AJ.js","assets/PlayerCard-8y-JtJlC.js","assets/RankedGame-DG1YJsfZ.js","assets/RulesPage-DGjHn7Ul.js","assets/StandeeMaker-Cnbwgi_s.js","assets/TableWarnings-Dac1pmDk.js","assets/Workshop-BKuudR8q.js","assets/_virtual_sandbox-worker-Ci5_c32w.js","assets/_virtual_soak-worker-CQuNFbKJ.js","assets/base64-gMTPUZJI.js","assets/book-BZLovR7G.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-D_DS4dk7.js","assets/de-JU6-cUab.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-C6umosuc.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DlsXG03X.js","assets/help-NXo3871J.js","assets/http-DKUZwSUN.js","assets/idb-OWIpJU7O.js","assets/index-CFndLGrL.css","assets/index-D_X7qB1t.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Br5JW75H.js","assets/lesson-02Au17xc.js","assets/levels-DlkUqTaf.js","assets/local-CzZs2UvO.js","assets/mailbox-D8L56aT-.js","assets/meshShape-BvikBrwx.js","assets/nostr-BUco5aZb.js","assets/packageChange-Be729-6H.js","assets/page-BRZBNJYV.js","assets/play-D8ahwNcA.js","assets/post-WegzB14L.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BTmaw6qv.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-C_-uwgKM.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-ClJGbzFL.js","assets/site-B823XLVz.js","assets/sound-IKskKEj2.js","assets/standIns-BHeYT5qd.js","assets/store-DLUCWOy3.js","assets/store-DwEYZsri.js","assets/store-Jkhnszgk.js","assets/store-ngVKXtrP.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-B2MexgGP.js","assets/talk-BHsnWhiP.js","assets/three.module-BnHMTVNq.js","assets/thumb-BkIF5qdq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-BLrK0NK_.js","assets/worker-CRddUSEl.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
