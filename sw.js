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
const VERSION = "96a885763df0";
const FILES = ["assets/Board-BE1hkJoy.js","assets/CommandPanel-DXA0TrZg.js","assets/CommandPanel-L9Of3SSG.js","assets/Editor-BbvBEVbD.js","assets/FigureLibrary-DbKN-DBJ.js","assets/GameScreen-BzmDFSLu.js","assets/MailLobby-D_F5Wbhb.js","assets/Miniatures-Clt8RwgM.js","assets/TableWarnings-BjWY84BT.js","assets/Workshop-CPzfiNtI.js","assets/_virtual_sandbox-worker-D8-sxG5N.js","assets/_virtual_soak-worker-CWd_04-t.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-BQS7vFFd.js","assets/codec-D2EJBc5v.js","assets/de-DHVISEM4.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DXMEliTm.js","assets/fr-BSE4lWrQ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CMeRHT0k.js","assets/idb-DySdWblq.js","assets/index-CDAcWHOc.css","assets/index-CDP8g87h.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-DVsviRNZ.js","assets/levels-DlkUqTaf.js","assets/library-Cajz9IGL.js","assets/local-DGrhskuw.js","assets/page-DAIlSQ0i.js","assets/react-DB-4Zxce.js","assets/replayFile-DcJLQxTj.js","assets/rift-lanterns-BYDQqtdB.js","assets/rolldown-runtime-CbXtAM7H.js","assets/scheduler-pDGbHDo7.js","assets/showcase-4KogP1IO.js","assets/store-BQ6TXJkm.js","assets/store-D5qbtYAB.js","assets/store-DBlrJWyO.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-yALz7cqx.js","assets/talk-CG0EZeOL.js","assets/trystero-DYVC-IfJ.js","assets/trystero-ijpxfbUO.js","assets/version-mSAMvB0c.js","assets/worker-DKPnAkbD.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
