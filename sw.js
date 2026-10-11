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
const VERSION = "5a1c2ac87631";
const FILES = ["assets/Board-DIyQBsIv.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-3x2nvdVH.js","assets/CommandPanel-DLgglJ0O.js","assets/CommandPanel-eEfNu3ap.js","assets/Editor-B2iyjUO8.js","assets/EventSeat-trWQ3EO0.js","assets/EventsUI-BqFYcQus.js","assets/FigureLibrary-DJmRHm_Z.js","assets/GameScreen-CgkwfdcD.js","assets/MailLobby-ImpIc-sW.js","assets/Miniatures-C_HObjyg.js","assets/OpenTables-D9wNJgqa.js","assets/PhotoMatch-DrHrFuwQ.js","assets/PlayerCard-Bdf2go-K.js","assets/RankedGame-B-Xl8ZvK.js","assets/RulesPage-CskvdzE-.js","assets/StandeeMaker-D5HaTMWn.js","assets/TeachRule-Dau375o7.js","assets/Workshop-DhK_nF9A.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-ggQb2QCM.js","assets/actions-DXPjYvOm.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-CRQcCc9x.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C-MdjvSz.js","assets/de-rs5JGgw5.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DI6Jgojb.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Dl0spHlX.js","assets/help-BkAgG6iP.js","assets/http-DU8uAS6O.js","assets/idb-OWIpJU7O.js","assets/index-Bn2LCUiN.js","assets/index-BrElkLzk.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-B2-sScSC.js","assets/lesson-DLqiE2ob.js","assets/levels-DlkUqTaf.js","assets/local-BpuNdtJS.js","assets/mailbox-CMIa1DxK.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DhjUxSuG.js","assets/nostr-BZhK7U7l.js","assets/pack-DUs2904N.js","assets/packageChange-Be729-6H.js","assets/page-jdubRGHv.js","assets/play-CapK6co_.js","assets/post-S_hS2eM0.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DhWMvD7v.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-B7paulPg.js","assets/report-BTo0ZFiP.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CUJsNSn6.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BX33EjvI.js","assets/store-C-LzdBLm.js","assets/store-D8NwHsJo.js","assets/store-L5SxwU81.js","assets/store-WK-7p5iu.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-HKEQ84VY.js","assets/talk-CSD4JPsW.js","assets/three.module-BnHMTVNq.js","assets/thumb-BFU2Esg3.js","assets/trystero-B_9jINH4.js","assets/trystero-DdNQWDzA.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BZP5E9T0.js","assets/worker-BhgkbdZ9.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
