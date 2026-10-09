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
const VERSION = "00126c13bad7";
const FILES = ["assets/Board-aU7jKdv9.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-B0OnMlRh.js","assets/CommandPanel-BvBp3n2l.js","assets/CommandPanel-Dwb2h0AE.js","assets/Editor-Cx5Pha1E.js","assets/EventSeat-Dru2bj82.js","assets/EventsUI-pqQ_xc4x.js","assets/FigureLibrary-D-FixSyn.js","assets/GameScreen-Cd6Cm0_W.js","assets/MailLobby-oDNTzhQt.js","assets/Miniatures-BDUdEBr4.js","assets/OpenTables-DT8cUiOz.js","assets/Packages-CFr9gYMA.js","assets/PlayerCard-CY7DI9VU.js","assets/RankedGame-BE3P5-Fw.js","assets/RulesPage-CGQgSQZV.js","assets/TableWarnings-CE4X-tfN.js","assets/Workshop-BPeMX3gp.js","assets/_virtual_sandbox-worker-DaEIUEIg.js","assets/_virtual_soak-worker-R0LKBZAq.js","assets/book-0YbbqmiU.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BVZeKnk6.js","assets/de--IVyn3Xj.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-vPFweQSe.js","assets/files-CdfAAl3C.js","assets/fr-Cr6umPKI.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CW87PfrE.js","assets/help-RozooxAq.js","assets/hooks-CayildH5.js","assets/http-DrU0t_Yw.js","assets/index-8-N0eDPk.css","assets/index-BL9lqh4S.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-CMVYqiED.js","assets/lesson-Bn_2f97p.js","assets/levels-DlkUqTaf.js","assets/local-D_DnzsvK.js","assets/mailbox-DOS-gPxV.js","assets/nostr-BOE1ZzuR.js","assets/packageChange-Be729-6H.js","assets/page-CcGt_PcA.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-6BqkXMrs.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CZqVk43F.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-grgMyV9-.js","assets/shelf-DP09T6Od.js","assets/showcase-CWG_wkHX.js","assets/site-B823XLVz.js","assets/sound-TYxYIDVS.js","assets/standIns-OXIxWlRR.js","assets/store-C41DVvN5.js","assets/store-CBtW4Xww.js","assets/store-D19PcBqc.js","assets/store-DRnkXdS4.js","assets/store-DkJ5tRxx.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-uNUwebbL.js","assets/talk-Dl-E3JPl.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-Ca9faGY1.js","assets/worker-Ci3yYh4Z.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
