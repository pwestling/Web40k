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
const VERSION = "fb4253d8456f";
const FILES = ["assets/Board-3ebHpw7s.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CW4RSf0t.js","assets/CommandPanel-KAGcI82e.js","assets/CommandPanel-VFeqVT0m.js","assets/Editor-DCU1sCoF.js","assets/EventSeat-CE4b51ry.js","assets/EventsUI-tPWfGWQX.js","assets/FigureLibrary-CrAS2_A1.js","assets/GameScreen-Bva4uv7_.js","assets/MailLobby-DQ8EccQi.js","assets/Miniatures-CDfRyqWi.js","assets/OpenTables-DFrA0PBu.js","assets/PhotoMatch-D_jL9AOi.js","assets/PlayerCard-CjKNCzgP.js","assets/RankedGame-CU0iLim9.js","assets/RulesPage-FjaZvTVy.js","assets/StandeeMaker-BFVmARsO.js","assets/TableWarnings-Bhq8ktFt.js","assets/Workshop-CzPDGykc.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-MOwv1Qqh.js","assets/actions-B4tCPypo.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-C3-BdKkA.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-hUXMP-5G.js","assets/de-Bg9ych9n.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-C7N53jJf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Ppj3JhBW.js","assets/help-D_rJ4t-l.js","assets/http-Ddr1v7PM.js","assets/idb-OWIpJU7O.js","assets/index-BKxtIgXv.js","assets/index-nJJcWpk2.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-0UJOGSeJ.js","assets/lesson-DhSq5rmo.js","assets/levels-DlkUqTaf.js","assets/local-PhtGolGa.js","assets/mailbox-DTObtkNJ.js","assets/manifest-bE-32xpp.js","assets/meshShape-BImmyngG.js","assets/nostr-1yRnP5iq.js","assets/pack-CTHg6IHu.js","assets/packageChange-Be729-6H.js","assets/page-zwlXb0L6.js","assets/play-M4ASSp1i.js","assets/post-Bkx6ODNM.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DeNEfZtP.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-DnQ2Wn_h.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CAg6rU7_.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-Bp2Mp6SO.js","assets/store-C9afU8h5.js","assets/store-DkpWXTvb.js","assets/store-Ulrj8lk5.js","assets/store-sQ81cW_q.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-B2aTNuXh.js","assets/talk-DerjfRUR.js","assets/three.module-BnHMTVNq.js","assets/thumb-CjLKfgOY.js","assets/trystero--Iwxw2BA.js","assets/trystero-DZwhgMKH.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-B5ew2XFO.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DuNuPb_J.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
