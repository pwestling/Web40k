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
const VERSION = "17a41709d087";
const FILES = ["assets/Board-WJMnBsW0.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-DNKd4I7R.js","assets/CommandPanel-D_8EmHHG.js","assets/CommandPanel-lquqrmGo.js","assets/Editor-Ch_zhFrj.js","assets/EventSeat-DW6XOqEj.js","assets/EventsUI-C4gWzI05.js","assets/FigureLibrary-CTff2r1g.js","assets/GameScreen-Bn4fSHbr.js","assets/MailLobby-Dcsa1tD6.js","assets/Miniatures-DRgnnsrn.js","assets/OpenTables-FL2jwry3.js","assets/PhotoMatch-BzU0Cp0d.js","assets/PlayerCard-BDYEBxrF.js","assets/RankedGame-DfyzJJDy.js","assets/RulesPage-BQqE8Xl2.js","assets/StandeeMaker-Bumsn4Ey.js","assets/TableWarnings-CPQKie7z.js","assets/Workshop-C_8OylaM.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-mykbN5FN.js","assets/actions-DAO3TLvO.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-k2NW12Kn.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DE2p4adP.js","assets/de-VfHGz2dO.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-D8xe3h6B.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-OwKCrSoE.js","assets/help-B-4M2zyg.js","assets/http-xUPCDF53.js","assets/idb-OWIpJU7O.js","assets/index-BzClt9e5.css","assets/index-CuxQCsU3.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-ByhpJ4kZ.js","assets/lesson-BBWM6Ztt.js","assets/levels-DlkUqTaf.js","assets/local-DqXXuI-b.js","assets/mailbox--xdSh4jv.js","assets/manifest-bE-32xpp.js","assets/meshShape-CmPqmEIO.js","assets/nostr-C7-DLwVL.js","assets/pack-BDXvv1Pn.js","assets/packageChange-Be729-6H.js","assets/page-G7uNwC0V.js","assets/play-CgFoUkhP.js","assets/post-CJG-L__x.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-21TaCRmw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-XN0SSn0F.js","assets/report-Dn90Yqnr.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CSXbFZ29.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-CZbsiB8G.js","assets/store-CeMJcd9w.js","assets/store-DJOYAGV1.js","assets/store-DUSr5s_t.js","assets/store-XIEYA6JE.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DSPFmiv2.js","assets/talk-DA-gpt1b.js","assets/three.module-BnHMTVNq.js","assets/thumb-_UO3sEMx.js","assets/trystero-C8npuljq.js","assets/trystero-Dn-8jchE.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BDyLbjGw.js","assets/worker-CtrB5Iye.js","assets/worker-D3JEratr.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
