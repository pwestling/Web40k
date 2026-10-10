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
const VERSION = "d4a6f74b9322";
const FILES = ["assets/Board-D4-RkFDw.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BcpklJFA.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-CIqyLR1Z.js","assets/EventSeat-Dhxw6Bta.js","assets/EventsUI-D6eLgVl-.js","assets/FigureLibrary-AVkqwzTJ.js","assets/GameScreen-Dda8tUif.js","assets/MailLobby-BcBAr4y3.js","assets/Miniatures-RJ-cC7l-.js","assets/OpenTables-LWH-k9S4.js","assets/PhotoMatch-n-7BfeqV.js","assets/PlayerCard-CXjLezNa.js","assets/RankedGame-CiKKQt21.js","assets/RulesPage-BxAOutUa.js","assets/StandeeMaker-Dprt3mjy.js","assets/TableWarnings-DMS3Sq4L.js","assets/Workshop-DULO74a6.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-DROwNiJM.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-ClXs4IUm.js","assets/de-CLZHqtRC.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-B-zruIgv.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-BAwkPNAH.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-QN4o1Hzm.js","assets/help-BigabWcw.js","assets/hooks-D8q14_y6.js","assets/http-BqsL1r5I.js","assets/idb-OWIpJU7O.js","assets/index-CXQ3yOmK.css","assets/index-w6el4hOw.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BpUpFbxM.js","assets/lesson-fNlTFtrP.js","assets/levels-DlkUqTaf.js","assets/local-CAHy1l8Y.js","assets/mailbox-BFg_Y71t.js","assets/nostr-DCgelF99.js","assets/packageChange-Be729-6H.js","assets/page-CJV_tvc_.js","assets/play-DgOEyGtZ.js","assets/post-CaVeh3YN.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DImUn9VC.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-awN3vG_F.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-MwllNvXC.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-EDqWNpGM.js","assets/showcase-DpWfnZW6.js","assets/site-B823XLVz.js","assets/sound-CjGpHfkS.js","assets/standIns-BHeYT5qd.js","assets/store-BZYDHNZF.js","assets/store-DCCnERCu.js","assets/store-DTninUkg.js","assets/store-WthhIZYC.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-B8DX5J9f.js","assets/talk-CeHvGrpe.js","assets/three.module-BnHMTVNq.js","assets/thumb-C1w4e5ff.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
