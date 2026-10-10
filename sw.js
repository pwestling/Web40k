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
const VERSION = "39cc8725dd1b";
const FILES = ["assets/Board-DtYi_REq.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/CommandPanel-bt0mP9vb.js","assets/Editor-DLkr1VDo.js","assets/EventSeat-CzUK7GLP.js","assets/EventsUI-CfeFFC8K.js","assets/FigureLibrary-DO6NFhTV.js","assets/GameScreen-DToDHO2e.js","assets/MailLobby-BN2OHnLO.js","assets/Miniatures-BBRhE0Am.js","assets/OpenTables-BPxcxk8p.js","assets/PhotoMatch-CnfRviXv.js","assets/PlayerCard-Be2JxxA_.js","assets/RankedGame-C1jUmJZt.js","assets/RulesPage-DdMF4Dnu.js","assets/StandeeMaker-ChI3hrbD.js","assets/TableWarnings-D3plrw_H.js","assets/Workshop-CfEl2_Fa.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-BRbjKt-q.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-Be51VWzH.js","assets/de-PxypyIbg.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Cq-xUdea.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-CxeTTLI3.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-B3ToL-aS.js","assets/help-BBQaSTk6.js","assets/hooks-DSAEXIAL.js","assets/http-CSNwQXJE.js","assets/idb-OWIpJU7O.js","assets/index-CXQ3yOmK.css","assets/index-DRKlBla1.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CWBda_2N.js","assets/lesson-BGTn0QN2.js","assets/levels-DlkUqTaf.js","assets/local-H7Qt-50m.js","assets/mailbox-Cxhi0xdS.js","assets/nostr-CKz-aAi4.js","assets/packageChange-Be729-6H.js","assets/page-C1ioelJE.js","assets/play-CTQd6w2y.js","assets/post-CGEr7a9M.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-uMDHHbGz.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-D23HCXVQ.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-BAzwz87I.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-DAhWSkKd.js","assets/showcase-C3n6EEGU.js","assets/site-B823XLVz.js","assets/sound-DLc6Qzyq.js","assets/standIns-BHeYT5qd.js","assets/store-C6bZRH9q.js","assets/store-D6CKYw0F.js","assets/store-fT0hOdlY.js","assets/store-mKAozu_s.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DytW81yX.js","assets/talk-TWAktclC.js","assets/three.module-BnHMTVNq.js","assets/thumb-BHkcTeFB.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
