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
const VERSION = "1203c3eff14e";
const FILES = ["assets/Board-Dvi9PTmk.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-C558VORV.js","assets/CommandPanel-D7NHvJ9C.js","assets/CommandPanel-p_hREyTg.js","assets/Editor-COgX6RoG.js","assets/EventSeat-48gxQNUf.js","assets/EventsUI-RCFxKBGh.js","assets/FigureLibrary-Bbz_r3kz.js","assets/GameScreen-DMtxro5Q.js","assets/MailLobby-DSvh-Gcm.js","assets/Miniatures-25RfZdNA.js","assets/OpenTables-BJ04anhl.js","assets/PhotoMatch-CVdueJip.js","assets/PlayerCard-CRGMsMcO.js","assets/RankedGame-BSjaBaPS.js","assets/RulesPage-DkSi_V0E.js","assets/StandeeMaker-CeyKkImO.js","assets/TeachRule-5Xilq06r.js","assets/Workshop-DlWJDIkn.js","assets/_virtual_sandbox-worker-CcMYQoC2.js","assets/_virtual_soak-worker-B9Uozsdh.js","assets/actions-BYMwMQWQ.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DmdUg-7M.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-qtwSMkI_.js","assets/de-DybNy2YM.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-ByNNtgCM.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BTEl0jco.js","assets/help-DdEil_Va.js","assets/http-D_l6Ioks.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-zovhoqrX.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-B5CeVZ_P.js","assets/lesson-CPtZspin.js","assets/levels-DlkUqTaf.js","assets/local-_d1glGNf.js","assets/mailbox-DQTH-xS4.js","assets/manifest-BRIPGYy3.js","assets/meshShape-Dw0Y8dTu.js","assets/nostr-9OFVA119.js","assets/pack-CeZpbKnl.js","assets/packageChange-Be729-6H.js","assets/page-BifzPj9R.js","assets/play-BAfyITIp.js","assets/post-DG4EfSAF.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DZYDiXKp.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-MVHFyjKx.js","assets/report-waT1ZQc9.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-B-HD6YQI.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-2Z0-XPja.js","assets/store-BnXkr7WG.js","assets/store-CCKKcUqM.js","assets/store-DA5s9wii.js","assets/store-QgCRglDD.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-WgIBZZ1T.js","assets/talk-DUiM98Lt.js","assets/three.module-BnHMTVNq.js","assets/thumb-OyhfZ5Fx.js","assets/trystero-Cvfabv4t.js","assets/trystero-dNljToKp.js","assets/trystero-wH_OvQaz.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BxDVyHPh.js","assets/worker-CtrB5Iye.js","assets/worker-DFopBS_8.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
