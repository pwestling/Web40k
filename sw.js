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
const VERSION = "49c39757593f";
const FILES = ["assets/Board-PO-DzhJ-.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-C21GR19C.js","assets/CommandPanel-D779fMzB.js","assets/CommandPanel-lxxZiJM0.js","assets/Editor-DuFnaUdz.js","assets/EventSeat-CbhOLrpk.js","assets/EventsUI-CI6Ra5IU.js","assets/FigureLibrary-FJeQskPp.js","assets/GameScreen-BCT65ued.js","assets/MailLobby-BfjEzSoB.js","assets/Miniatures-0u4sfLUK.js","assets/OpenTables-C6Zydo2N.js","assets/PhotoMatch-ivY0xL90.js","assets/PlayerCard-CCajOC9Y.js","assets/RankedGame-02sCG1hR.js","assets/RulesPage-BQqE8Xl2.js","assets/StandeeMaker-BYIq6sxK.js","assets/TableWarnings-BRbq8ReC.js","assets/Workshop-DHGPcT9n.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-D8nQhA-X.js","assets/actions-D8mRm2YZ.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-k2NW12Kn.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DE2p4adP.js","assets/de-VfHGz2dO.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-D8xe3h6B.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DsStBcYV.js","assets/help-46DGmXS3.js","assets/http-xUPCDF53.js","assets/idb-OWIpJU7O.js","assets/index-DbZI4dPy.css","assets/index-G-ux-3vb.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-ByhpJ4kZ.js","assets/lesson-BBWM6Ztt.js","assets/levels-DlkUqTaf.js","assets/local-DqXXuI-b.js","assets/mailbox--xdSh4jv.js","assets/manifest-bE-32xpp.js","assets/meshShape-F-osl__G.js","assets/nostr-C7-DLwVL.js","assets/pack-9zbU0dQF.js","assets/packageChange-Be729-6H.js","assets/page-BoEKXaGV.js","assets/play-BgONH_GY.js","assets/post-CJG-L__x.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-21TaCRmw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-COWIQ5ng.js","assets/report-D5-VYlml.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-mfkfD_qA.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-BxmHlQw2.js","assets/store-CbznYj4m.js","assets/store-DVs9Cckp.js","assets/store-Dn6i76qr.js","assets/store-XIEYA6JE.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DSPFmiv2.js","assets/talk-Bcjc6XXp.js","assets/three.module-BnHMTVNq.js","assets/thumb-k_1nYqlj.js","assets/trystero-ChGwfII8.js","assets/trystero-CyaspR-I.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BpnIzJfB.js","assets/worker-BzD7qmdf.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
