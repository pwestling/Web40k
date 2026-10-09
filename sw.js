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
const VERSION = "e05a776e8f9a";
const FILES = ["assets/Board-DP0c8XNk.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-B1SsNrq6.js","assets/CommandPanel-Dj_iC4ZQ.js","assets/CommandPanel-ra_bYxdX.js","assets/Editor-3VRjdLBG.js","assets/EventSeat-CUAtH00I.js","assets/EventsUI-BxVN6FZ4.js","assets/FigureLibrary-C_3lggAr.js","assets/GameScreen-BmqT1QFs.js","assets/MailLobby-bbcMM8M8.js","assets/Miniatures-D4HgZ6k4.js","assets/OpenTables-DfJd8XIA.js","assets/PlayerCard-CtvwzWLU.js","assets/RankedGame-Bsii71JZ.js","assets/RulesPage-C4KB3EXZ.js","assets/StandeeMaker-TJH7z8r6.js","assets/TableWarnings-C-U9weUO.js","assets/Workshop-BSwB3MyI.js","assets/_virtual_sandbox-worker-ChCEA-Zh.js","assets/_virtual_soak-worker-DCCuiKde.js","assets/base64-gMTPUZJI.js","assets/book-BPt9Sn4J.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BDr3zgja.js","assets/de-B_8UgRMQ.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CFL1L55R.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DNLgdou1.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CyBVR3MZ.js","assets/help-r6k25yGm.js","assets/hooks-CxLjE3zT.js","assets/http-VF6CgFx9.js","assets/index-DPW3KVmL.css","assets/index-DwHjm1_i.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-B3FW2G1n.js","assets/lesson-nLZx3Nop.js","assets/levels-DlkUqTaf.js","assets/local-mMnQhqxz.js","assets/mailbox-D_73wfUM.js","assets/nostr-AWNdcjGG.js","assets/packageChange-Be729-6H.js","assets/page-DX3WIzwR.js","assets/play-Ck_SXdGN.js","assets/post-Bx0m8DXU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CQz_Os2N.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Bex4d91Q.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-BqYfG6Hd.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-Bt35HbGu.js","assets/showcase-BGlouo4h.js","assets/site-B823XLVz.js","assets/sound-Bmm7wAsU.js","assets/standIns-BHeYT5qd.js","assets/store---BdSzIa.js","assets/store-B-0ZVW5e.js","assets/store-B2aWAKJY.js","assets/store-Le7T3n99.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-zzOevBto.js","assets/talk-C3JlqTEm.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-AN255kZl.js","assets/worker-By0MHVT_.js","assets/worker-DhDq6gEW.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
