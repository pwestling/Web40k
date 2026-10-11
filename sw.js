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
const VERSION = "da447ab27f84";
const FILES = ["assets/Board-BcT8RBmH.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-DMclYxPX.js","assets/CommandPanel-DUHMIGKn.js","assets/CommandPanel-_AtZH87f.js","assets/Editor-Diyci-5D.js","assets/EventSeat-Bb_g0yc0.js","assets/EventsUI-BBxwP_st.js","assets/FigureLibrary-BhnEkHAp.js","assets/GameScreen-DMpOC5t7.js","assets/MailLobby-CnfmuX_H.js","assets/Miniatures-CFfCJWoW.js","assets/OpenTables-DDsOMdv1.js","assets/PhotoMatch-DaxXIZQY.js","assets/PlayerCard-CgqK_rCa.js","assets/RankedGame-CjKXdhnH.js","assets/RulesPage-_zFCLu9M.js","assets/StandeeMaker-NYjhyQB5.js","assets/TeachRule-BWDrJvzR.js","assets/Workshop-CELGPizx.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-CBatySUI.js","assets/actions-xVfW8WOR.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-OU9mY9se.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DdAwOYyC.js","assets/de-BDQr8Vl6.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-Bmoe-nxc.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-a4bhF26a.js","assets/help-UdZUR9_X.js","assets/http-CQAF5Zc3.js","assets/idb-OWIpJU7O.js","assets/index-D-3pV7jZ.css","assets/index-jRnlioUX.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-7L6fARu_.js","assets/lesson-Bfkes_Bq.js","assets/levels-DlkUqTaf.js","assets/local-Cbv-7ZGm.js","assets/mailbox-CxZ0jQK0.js","assets/manifest-BRIPGYy3.js","assets/meshShape-CQT8-Z7r.js","assets/nostr-GllCTdqC.js","assets/pack-Tzy9TpcR.js","assets/packageChange-Be729-6H.js","assets/page-goztsbt8.js","assets/play-dR64bSX2.js","assets/post-kT7D_oEU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CjZ1khMw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Ch8J2_gF.js","assets/report-Bx5uWyt7.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CeDBSezV.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-6TKK_PyH.js","assets/store-81Ko2uEb.js","assets/store-CcTcvrCW.js","assets/store-DSC80uBc.js","assets/store-Dhb3Br0z.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BvYI-P0_.js","assets/talk-CGea5KUC.js","assets/three.module-BnHMTVNq.js","assets/thumb-BlcYaHIA.js","assets/trystero-_YSwLCPe.js","assets/trystero-dNljToKp.js","assets/trystero-vIrgVb7Y.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CewLl5y4.js","assets/worker-Cm6iV76x.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
