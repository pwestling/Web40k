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
const VERSION = "d1b6aeb599e6";
const FILES = ["assets/Board-DnuJjRRU.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BmW1mmwR.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-D4MdjF0D.js","assets/EventSeat-DN1-cVSc.js","assets/EventsUI-DxWZIwLU.js","assets/FigureLibrary-CqLEWJ73.js","assets/GameScreen-DMhOoXs-.js","assets/MailLobby-BV-oYY4-.js","assets/Miniatures-BWbKNa_i.js","assets/OpenTables-JFgZglsJ.js","assets/PhotoMatch-Critf5kW.js","assets/PlayerCard-D2Q5530B.js","assets/RankedGame-D3HQ58HS.js","assets/RulesPage-DdMF4Dnu.js","assets/StandeeMaker--k4yTKtu.js","assets/TableWarnings-q_DZTHPD.js","assets/Workshop-D0F5NXN_.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-BRbjKt-q.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-Be51VWzH.js","assets/de-PxypyIbg.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Cq-xUdea.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-CxeTTLI3.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BJBwx984.js","assets/help-71Z3lEJt.js","assets/hooks-BWZFopzu.js","assets/http-CSNwQXJE.js","assets/idb-OWIpJU7O.js","assets/index-CXQ3yOmK.css","assets/index-y6cbKxid.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CWBda_2N.js","assets/lesson-BGTn0QN2.js","assets/levels-DlkUqTaf.js","assets/local-H7Qt-50m.js","assets/mailbox-Cxhi0xdS.js","assets/nostr-CKz-aAi4.js","assets/packageChange-Be729-6H.js","assets/page-D-NpwA1l.js","assets/play-B61IE-d_.js","assets/post-CGEr7a9M.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-uMDHHbGz.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CnVpeHIx.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-Bp5WC1ok.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-DAhWSkKd.js","assets/showcase-C3n6EEGU.js","assets/site-B823XLVz.js","assets/sound-DLc6Qzyq.js","assets/standIns-BHeYT5qd.js","assets/store-BgS-Fz6p.js","assets/store-C6bZRH9q.js","assets/store-D3Z6pk15.js","assets/store-DNKTd2I2.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DytW81yX.js","assets/talk-CGJdqasO.js","assets/three.module-BnHMTVNq.js","assets/thumb-DDn4Ri1G.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
