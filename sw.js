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
const VERSION = "8ef2b9929cd5";
const FILES = ["assets/Board-FyqZ4FBP.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BuqrrtA0.js","assets/CommandPanel-LWEUxm9O.js","assets/CommandPanel-bYECFR5g.js","assets/Editor-DB_tuiwu.js","assets/EventSeat-CrcoEOY5.js","assets/EventsUI-MZ0Y8drx.js","assets/FigureLibrary-DUbSKXGw.js","assets/GameScreen-u7vIpiUj.js","assets/MailLobby-CNLNlaK4.js","assets/Miniatures-DM0153BC.js","assets/OpenTables-AaWEcti-.js","assets/PhotoMatch-jiev25WF.js","assets/PlayerCard-tDNd-5bb.js","assets/RankedGame-R9z9RqoJ.js","assets/RulesPage-BeD_JZEO.js","assets/StandeeMaker-tcXCOMZN.js","assets/TableWarnings-DcsvQTc2.js","assets/Workshop-B9LMBqqo.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-DfL5Hsie.js","assets/actions-BhDMLKiZ.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BGbALnxc.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C8dHfTTz.js","assets/de-D5LhAjwf.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-CsXGc2Y_.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-C_273g5o.js","assets/help-Ch5blmxN.js","assets/http-DzYksB3j.js","assets/idb-OWIpJU7O.js","assets/index-CPyXjX5n.css","assets/index-DpXEaptj.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-YZQb_Vx8.js","assets/lesson-ChtrbGCq.js","assets/levels-DlkUqTaf.js","assets/local-BvL2z8H1.js","assets/mailbox-CG8RPJvs.js","assets/manifest-bE-32xpp.js","assets/meshShape-fsHy3Mbf.js","assets/nostr-CNpN_yZV.js","assets/pack-CRGD8Xza.js","assets/packageChange-Be729-6H.js","assets/page-CahRqftB.js","assets/play-DTNvh5qM.js","assets/post-FQ_c24EH.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BSqut5pg.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-wwYi5AaS.js","assets/report-CJBtCuU4.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-UKXLAR9l.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-B3Vsvu5e.js","assets/store-CiYnDWvH.js","assets/store-Cw8CiWGB.js","assets/store-D0XbBOnd.js","assets/store-DtNCehP6.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Bwjhbm-e.js","assets/talk-DEN9hiGn.js","assets/three.module-BnHMTVNq.js","assets/thumb-BAmG5t3h.js","assets/trystero-5knVWzgC.js","assets/trystero-dNljToKp.js","assets/trystero-sf5Lk7Pd.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BUwssCuX.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DxJIXbYR.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
