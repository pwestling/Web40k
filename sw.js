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
const VERSION = "62c9ad50b547";
const FILES = ["assets/Board-BLbEV8nq.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/CommandPanel-fOb8NseM.js","assets/Editor-D1jec9l9.js","assets/EventSeat-CDLsy6Yq.js","assets/EventsUI-Ddypc_LI.js","assets/FigureLibrary-Bxr2FzyP.js","assets/GameScreen-DNhjhkrV.js","assets/MailLobby-DDJrx8yk.js","assets/Miniatures-251Na47p.js","assets/OpenTables-BXCl70ed.js","assets/PhotoMatch-D8Dqi9IR.js","assets/PlayerCard-A0t6PKWs.js","assets/RankedGame-_xOBIKFr.js","assets/RulesPage-CIbCPgTp.js","assets/StandeeMaker-Ce3JS7Si.js","assets/TableWarnings-CtpvIxOR.js","assets/Workshop-CiOkZBi9.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-Ci4g6P4R.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-tcLkDpbL.js","assets/de-DBauFDFQ.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CWDKk9N7.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-ElcwV3hi.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-D2a3_LY_.js","assets/help-au4vIxJg.js","assets/hooks-CrMLQnbG.js","assets/http-3nd0cHoY.js","assets/idb-OWIpJU7O.js","assets/index-Bpe35z83.js","assets/index-CXQ3yOmK.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CBRMs8Yg.js","assets/lesson-DmtK-JGQ.js","assets/levels-DlkUqTaf.js","assets/local-BaEgJcbN.js","assets/mailbox-Ceyu_6sr.js","assets/nostr-BcKt-0VI.js","assets/packageChange-Be729-6H.js","assets/page-irTImO0e.js","assets/play-Bj8lK33B.js","assets/post-DDWJxbDG.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-WYyBlV-B.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CtbdilHC.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-zwBOnF3I.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-Bqjgghs8.js","assets/showcase-CLlOkjoJ.js","assets/site-B823XLVz.js","assets/sound-CSsnPEIB.js","assets/standIns-BHeYT5qd.js","assets/store-Bxswv629.js","assets/store-C3LcaUAD.js","assets/store-CKAPxzIy.js","assets/store-g4TF4QSF.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CPeUH2vu.js","assets/talk-S1IbhklG.js","assets/three.module-BnHMTVNq.js","assets/thumb-D4wkHpf-.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
