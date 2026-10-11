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
const VERSION = "3fbc8fd0c7c8";
const FILES = ["assets/Board-C9Zc8_F0.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-3SWPekWN.js","assets/CommandPanel-Xx8C9J8H.js","assets/CommandPanel-yZh23Vtc.js","assets/Editor-WCsl7QNi.js","assets/EventSeat-V2YO-S4q.js","assets/EventsUI-uIoJFdTD.js","assets/FigureLibrary-CWurVNHA.js","assets/GameScreen-Di6MBdCR.js","assets/MailLobby-CG2B4jjP.js","assets/Miniatures-BOWtdZA5.js","assets/OpenTables-DUWTAr_3.js","assets/PhotoMatch-CZgz4gNh.js","assets/PlayerCard-DVfg4rc_.js","assets/RankedGame-C4AR-COS.js","assets/RulesPage-BK6Ye7Pv.js","assets/StandeeMaker-DxwHbzuo.js","assets/TeachRule-Dgt8Qs6a.js","assets/Workshop-Bsc5vMHS.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-Cx9cOmEm.js","assets/actions-DRCwr9tu.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-D5avdjWc.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-CBfj-Rjm.js","assets/de-DdXC47qo.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-Cj1BqYNc.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-C2HrxrR8.js","assets/help-BTlf2nsI.js","assets/http-DvFtI46I.js","assets/idb-OWIpJU7O.js","assets/index-CvzWN_7P.js","assets/index-DLgDh0SQ.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-4LVpRD7Y.js","assets/lesson-CYEHZ-XM.js","assets/levels-DlkUqTaf.js","assets/local-BKs5Pp3_.js","assets/mailbox-D2hmoz5s.js","assets/manifest-BRIPGYy3.js","assets/meshShape-FXJkk4UY.js","assets/nostr-BXv1NB5k.js","assets/pack-Cgh1UyGs.js","assets/packageChange-Be729-6H.js","assets/page-LtZyxUxD.js","assets/play-D3QdsJzT.js","assets/post-ChMLNTJV.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-B9V7jt0W.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-B1QZ1tYP.js","assets/report-CRYdaynA.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BtAEw8DV.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BFEtJYR9.js","assets/store-BO5x3iTq.js","assets/store-BWPrplBj.js","assets/store-CaN5-Zll.js","assets/store-Cycyv0YP.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-C06Lgpts.js","assets/talk-DDzMaFve.js","assets/three.module-BnHMTVNq.js","assets/thumb-D2NSmQcR.js","assets/trystero-C-McnECd.js","assets/trystero-dNljToKp.js","assets/trystero-iy1xqxLw.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-B67Chif3.js","assets/worker-BWRfj6JC.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
