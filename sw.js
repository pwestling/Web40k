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
const VERSION = "06bcd1634d30";
const FILES = ["assets/Board-DjFdrkeT.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-4IjNDClQ.js","assets/CommandPanel-C2hCd_Ex.js","assets/CommandPanel-DBF4hr0U.js","assets/Editor-D5E86OXR.js","assets/EventSeat-2_O7KD0M.js","assets/EventsUI-Ca3Ghbnn.js","assets/FigureLibrary-DrS4-KzU.js","assets/GameScreen-Bnik6LD-.js","assets/MailLobby-Cm9ULDVI.js","assets/Miniatures-DF09n_6e.js","assets/OpenTables-CHUISlsG.js","assets/Packages-Ce09D0SB.js","assets/PlayerCard-DjPRKHH5.js","assets/RankedGame-D7flEYJm.js","assets/RulesPage-KN6PWzJn.js","assets/StandeeMaker-DYCaVpkP.js","assets/TableWarnings-9hv5LNfF.js","assets/Workshop-DLWiXd5n.js","assets/_virtual_sandbox-worker-Dct3xvTj.js","assets/_virtual_soak-worker-D_B1XrA8.js","assets/base64-gMTPUZJI.js","assets/book-CKOBy0uC.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-CXY7fp7n.js","assets/de-BnqxOYZx.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DufzlklL.js","assets/files-CdfAAl3C.js","assets/fr-BbWE7TAq.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CZ5qPOdB.js","assets/help-EQItak8w.js","assets/hooks-ohCYGb2H.js","assets/http-BofPjwld.js","assets/index-BWQc-so8.css","assets/index-kX_WCJnL.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-zDeXfPaL.js","assets/lesson-BZ3AIPN3.js","assets/levels-DlkUqTaf.js","assets/local-CnjOylZG.js","assets/mailbox-BDH0fQFI.js","assets/nostr-BNxSCNX7.js","assets/packageChange-Be729-6H.js","assets/page-KtfEJQVs.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-mA-D6J-v.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-C24537Oh.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-CWT1-Dxy.js","assets/shelf-S0zfdG4O.js","assets/showcase-C9x78C42.js","assets/site-B823XLVz.js","assets/sound-OccIU2KL.js","assets/standIns-BHeYT5qd.js","assets/store-BxtI5I9o.js","assets/store-CVMKodgi.js","assets/store-Cncnfby4.js","assets/store-DDvPs6So.js","assets/store-rrwcFhkv.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CyxFF_7K.js","assets/talk-8NF2KNVV.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-Do0AGqGh.js","assets/worker-DuUTqMsS.js","assets/worker-zPimb7RQ.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
