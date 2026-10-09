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
const VERSION = "8ad567c3ef25";
const FILES = ["assets/Board-k_h-5dl2.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-4IjNDClQ.js","assets/CommandPanel-C2hCd_Ex.js","assets/CommandPanel-EjfrFaJV.js","assets/Editor-Dpg0RDiV.js","assets/EventSeat-ChcFp-RA.js","assets/EventsUI-fbahk7Cs.js","assets/FigureLibrary-D-YNseFc.js","assets/GameScreen-B3BD2ybT.js","assets/MailLobby-DKg5oQqd.js","assets/Miniatures-CZ7IWBMr.js","assets/OpenTables-DTZHur9y.js","assets/Packages-CeX715W4.js","assets/PlayerCard-D2WS64mL.js","assets/RankedGame-DPC-uIJ4.js","assets/RulesPage-N1E9BNwd.js","assets/StandeeMaker-C-8sC_Og.js","assets/TableWarnings-BV6HOPhP.js","assets/Workshop-CjdZcjbk.js","assets/_virtual_sandbox-worker-Dct3xvTj.js","assets/_virtual_soak-worker-D_B1XrA8.js","assets/base64-gMTPUZJI.js","assets/book-DvxX_qoE.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-B2_bR5V7.js","assets/de-BN9H8icf.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CrOCE9e4.js","assets/files-CdfAAl3C.js","assets/fr-DYdlmZ1s.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Cx24ZP6A.js","assets/help-DyY3MidS.js","assets/hooks-SbA9WzEw.js","assets/http-uzoPQbRq.js","assets/index-B-zbuMOE.js","assets/index-BxBINOfu.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-CBpmaNPN.js","assets/lesson-IU2qJADA.js","assets/levels-DlkUqTaf.js","assets/local-DMMZbGtT.js","assets/mailbox-AvjHxk8u.js","assets/nostr-CSvu2TVS.js","assets/packageChange-Be729-6H.js","assets/page-DxNc_gMU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BFu8xVLE.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-0lWJZ9Nx.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-BYBvHsGO.js","assets/shelf-2IWWseuK.js","assets/showcase-BzyPdson.js","assets/site-B823XLVz.js","assets/sound-C8PU-vfE.js","assets/standIns-BHeYT5qd.js","assets/store-BhxdUTBr.js","assets/store-Blmc37Gh.js","assets/store-CDkv6SAk.js","assets/store-D-RnqvcS.js","assets/store-o9o9pAk3.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CPmFyYsP.js","assets/talk-DcakJHaf.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-Do0AGqGh.js","assets/worker-DuUTqMsS.js","assets/worker-zPimb7RQ.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
