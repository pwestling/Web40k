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
const VERSION = "901f07e71c48";
const FILES = ["assets/Board-Cgkgr09k.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel--0dLTIRX.js","assets/CommandPanel-BWr9K589.js","assets/CommandPanel-BuVurR4S.js","assets/Editor--zn1nF6U.js","assets/EventSeat-TpUIx6GM.js","assets/EventsUI-BWrtUyUB.js","assets/FigureLibrary-CaeFKMui.js","assets/GameScreen-ZnXoY1ou.js","assets/MailLobby-DMAAXkIj.js","assets/Miniatures-srRTX9RY.js","assets/OpenTables-vxSo4Wfu.js","assets/PhotoMatch-D5r9Pun9.js","assets/PlayerCard-Bo7d0U_8.js","assets/RankedGame-DQMV4yPb.js","assets/RulesPage-NuE1BjRN.js","assets/StandeeMaker-BckVGuDj.js","assets/TeachRule-C3iUGJ0n.js","assets/Workshop-BhxN2n82.js","assets/_virtual_sandbox-worker-CmAYGbsX.js","assets/_virtual_soak-worker-DXFnLtuy.js","assets/actions-CwiPM8gZ.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-CEAqWnvv.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-Dh9pP4jo.js","assets/de-DOPd358e.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-Cu05_t5l.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Brj1dm67.js","assets/help-dLgNtYME.js","assets/http-TryCcu4K.js","assets/idb-OWIpJU7O.js","assets/index-Cx3-Bc6E.css","assets/index-D6Wtt7O6.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DVRN3rhJ.js","assets/lesson-CG0siLdf.js","assets/levels-DlkUqTaf.js","assets/local-BQGE-U5K.js","assets/mailbox-DZXt20VM.js","assets/manifest-BRIPGYy3.js","assets/meshShape-npZpPewM.js","assets/nostr-CU8TA2rz.js","assets/pack-D4AWO4pu.js","assets/packageChange-Be729-6H.js","assets/page-BkX6pAge.js","assets/play-CvRCTwbu.js","assets/post-BQdKsPsk.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DJzZVftf.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-_XBDzCdr.js","assets/report-mVGiPAg-.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CIqUcnnR.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BXlNqVyE.js","assets/store-BqfUxHVI.js","assets/store-BxpOQvBQ.js","assets/store-DF9NM6NN.js","assets/store-DkVlwekq.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DKMSNuPS.js","assets/talk-B5qn3iVa.js","assets/three.module-BnHMTVNq.js","assets/thumb-DS8CTL3l.js","assets/trystero-DLPXcNNb.js","assets/trystero-Tgxq3ep5.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BodpogQF.js","assets/worker-CtrB5Iye.js","assets/worker-Cz1oJ23X.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
