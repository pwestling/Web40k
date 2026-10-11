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
const VERSION = "67eca2958ba1";
const FILES = ["assets/Board-BbaCH8g3.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CYG8Aqro.js","assets/CommandPanel-D11CeqXi.js","assets/CommandPanel-DJwLTCah.js","assets/Editor-CnK7xff3.js","assets/EventSeat-Dcnmq6t4.js","assets/EventsUI-CZAINrh_.js","assets/FigureLibrary-CiMYGKrY.js","assets/GameScreen-DaYdtUkL.js","assets/MailLobby-C_lRy--b.js","assets/Miniatures-DZYOejlo.js","assets/OpenTables-DjRvgEVF.js","assets/PhotoMatch-Cs_oSuDa.js","assets/PlayerCard-DC6Ihr5l.js","assets/RankedGame-BQrhgJYT.js","assets/RulesPage-ByMBQE-r.js","assets/StandeeMaker-8EmKRcK0.js","assets/TeachRule-Coan2NCw.js","assets/Workshop-b-vlyGbF.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-eCC3uI-h.js","assets/actions-C8njsIA9.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-NBB32M_O.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-D5mKy1uS.js","assets/de-B8ppHE4C.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-Dp_Ae1AJ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BeaTHbZX.js","assets/help-BnPnB8Wq.js","assets/http-DZamrkcK.js","assets/idb-OWIpJU7O.js","assets/index-D-3pV7jZ.css","assets/index-DG9vWDln.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Bq1Ku3NK.js","assets/lesson-CR7UBNgN.js","assets/levels-DlkUqTaf.js","assets/local-B6QiOoIE.js","assets/mailbox-B09pxAmt.js","assets/manifest-BRIPGYy3.js","assets/meshShape-Bf2M3_xf.js","assets/nostr-TlcsvN7y.js","assets/pack-DJd9E8VW.js","assets/packageChange-Be729-6H.js","assets/page-DftlJREx.js","assets/play-DUxw8Afu.js","assets/post-QQug10H-.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-yTDeOp-i.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Eu_5grf_.js","assets/report-CTMj4Luy.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CcoU2Cpf.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-B0sWqt3t.js","assets/store-B4rIznHJ.js","assets/store-BDsOggnf.js","assets/store-CqwI_Hiy.js","assets/store-CyewbBto.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BCqx3AGu.js","assets/talk-DlPlT41p.js","assets/three.module-BnHMTVNq.js","assets/thumb-DBZJkVEE.js","assets/trystero-0plHXLQ7.js","assets/trystero-dNljToKp.js","assets/trystero-qLQSN6kY.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BHmT9ryM.js","assets/worker-BroU7LSC.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
