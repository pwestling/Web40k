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
const VERSION = "7936d6376f0b";
const FILES = ["assets/Board-DJXBCVKa.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-C9arwgo1.js","assets/CommandPanel-D55GXEq1.js","assets/CommandPanel-DY2Q0Yux.js","assets/Editor-Dd_1Y44c.js","assets/EventSeat-C6p8X1sI.js","assets/EventsUI-d2-A6t9m.js","assets/FigureLibrary-EVRabWvY.js","assets/GameScreen-BfnQkuK_.js","assets/MailLobby-BzNFtLWj.js","assets/Miniatures-CBQ82LNC.js","assets/OpenTables-xjd8gxcK.js","assets/PhotoMatch-DNpIPGjm.js","assets/PlayerCard-wO9qYa_d.js","assets/RankedGame-Dd1LPtAm.js","assets/RulesPage-BPTPVmon.js","assets/StandeeMaker-dbzBRx7E.js","assets/TableWarnings-kmMJJlsC.js","assets/Workshop-Bxr9mG3b.js","assets/_virtual_sandbox-worker-BIhhQN2P.js","assets/_virtual_soak-worker-BTtFDErA.js","assets/base64-gMTPUZJI.js","assets/book-DdegdSz4.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-C26iHaGZ.js","assets/de-DnbRfOsW.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-BLKNQiHl.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-By_D_cGS.js","assets/help-Cu2Zovdb.js","assets/hooks-2ViI1Ynz.js","assets/http-BXXEMFnZ.js","assets/idb-OWIpJU7O.js","assets/index-BRTsq8ax.js","assets/index-EUhTXr_o.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DG_S7_Ml.js","assets/lesson-CTjlEFBc.js","assets/levels-DlkUqTaf.js","assets/local-Dml9gCAI.js","assets/mailbox-DLq1bAfF.js","assets/meshShape-CeJgSdfX.js","assets/nostr-DdhXRy7S.js","assets/packageChange-Be729-6H.js","assets/page-Cl6K8nbD.js","assets/play-e-h-lJER.js","assets/post-CQWMdxUd.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-G1lY6tAa.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CvSGjV3u.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-BGKj5dd6.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-DZ51CgQ5.js","assets/site-B823XLVz.js","assets/sound-DNtP7J1L.js","assets/standIns-BHeYT5qd.js","assets/store-BaZh7s4s.js","assets/store-DnKCpdOx.js","assets/store-DrneDTaP.js","assets/store-Ds8A7S6T.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-ypF-0ESc.js","assets/talk-xUusIA5y.js","assets/three.module-BnHMTVNq.js","assets/thumb-BdiaNaXR.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-C1_lO3_n.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DZYxyfCH.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
